// Google Drive Integration for VEX Path Planner
// Enables saving, loading, and syncing projects directly to/from user's personal Google Drive.
// Works 100% client-side from GitHub Pages, Cloud Run, localhost, or any web host.

(function() {
  let driveAccessToken = localStorage.getItem("gdrive_access_token") || null;
  let driveTokenExpiry = Number(localStorage.getItem("gdrive_token_expiry")) || 0;

  async function getDriveAccessToken(forcePrompt = false) {
    const now = Date.now();
    if (!forcePrompt && driveAccessToken && driveTokenExpiry > now + 60000) {
      return driveAccessToken;
    }

    if (typeof firebase === "undefined" || !firebase.auth) {
      throw new Error("Firebase Auth SDK not loaded.");
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope("https://www.googleapis.com/auth/drive.file");
    provider.setCustomParameters({ prompt: "select_account" });

    try {
      const result = await firebase.auth().signInWithPopup(provider);
      if (!result.credential || !result.credential.accessToken) {
        throw new Error("Failed to obtain Google Drive access token.");
      }

      driveAccessToken = result.credential.accessToken;
      driveTokenExpiry = Date.now() + 3500 * 1000;
      localStorage.setItem("gdrive_access_token", driveAccessToken);
      localStorage.setItem("gdrive_token_expiry", driveTokenExpiry);

      return driveAccessToken;
    } catch (err) {
      localStorage.removeItem("gdrive_access_token");
      localStorage.removeItem("gdrive_token_expiry");
      driveAccessToken = null;
      driveTokenExpiry = 0;
      throw new Error("Google Drive Authorization Failed: " + (err.message || err));
    }
  }

  async function fetchWithAuth(url, options = {}) {
    let token = await getDriveAccessToken();
    options.headers = options.headers || {};
    options.headers.Authorization = `Bearer ${token}`;

    let res = await fetch(url, options);

    // If 401 Unauthorized, token is stale or revoked — force account selection & retry
    if (res.status === 401) {
      console.warn("[GoogleDriveSync] Token 401 expired, requesting fresh OAuth token...");
      token = await getDriveAccessToken(true);
      options.headers.Authorization = `Bearer ${token}`;
      res = await fetch(url, options);
    }

    if (!res.ok) {
      let errDetail = res.statusText;
      try {
        const errJson = await res.json();
        if (errJson && errJson.error && errJson.error.message) {
          errDetail = errJson.error.message;
        }
      } catch (e) {}
      throw new Error(`Google Drive API (${res.status}): ${errDetail}`);
    }

    return res;
  }

  async function getOrCreateDriveFolder() {
    try {
      const searchUrl = "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({
        q: "mimeType='application/vnd.google-apps.folder' and name='VEX Path Planner' and trashed=false",
        fields: "files(id, name)"
      });

      const searchRes = await fetchWithAuth(searchUrl);
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        return searchData.files[0].id;
      }

      // Create 'VEX Path Planner' folder
      const createRes = await fetchWithAuth("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "VEX Path Planner",
          mimeType: "application/vnd.google-apps.folder"
        })
      });

      const createData = await createRes.json();
      return createData.id;
    } catch (err) {
      console.warn("[GoogleDriveSync] Folder creation fallback to root:", err.message);
      return null; // Fall back to root folder if folder creation is restricted
    }
  }

  async function saveProjectToDrive(projectData, customFilename = null) {
    const folderId = await getOrCreateDriveFolder();
    const name = customFilename || (projectData.name ? `${projectData.name}.vexproj.json` : "MyVEXProject.vexproj.json");
    const content = JSON.stringify(projectData, null, 2);

    let fileId = null;
    if (folderId) {
      try {
        const q = `'${folderId}' in parents and name='${name}' and trashed=false`;
        const checkUrl = "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({ q, fields: "files(id, name)" });
        const checkRes = await fetchWithAuth(checkUrl);
        const checkData = await checkRes.json();
        if (checkData.files && checkData.files.length > 0) {
          fileId = checkData.files[0].id;
        }
      } catch (e) {}
    }

    if (fileId) {
      // Update existing file
      const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
      await fetchWithAuth(updateUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: content
      });

      return { fileId, name, updated: true };
    } else {
      // Create new multipart file upload
      const metadata = {
        name: name,
        mimeType: "application/json"
      };
      if (folderId) metadata.parents = [folderId];

      const boundary = "-------314159265358979323846";
      const delimiter = "\r\n--" + boundary + "\r\n";
      const close_delim = "\r\n--" + boundary + "--";

      const multipartRequestBody =
        delimiter +
        "Content-Type: application/json\r\n\r\n" +
        JSON.stringify(metadata) +
        delimiter +
        "Content-Type: application/json\r\n\r\n" +
        content +
        close_delim;

      const uploadUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
      const uploadRes = await fetchWithAuth(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipartRequestBody
      });

      const uploadData = await uploadRes.json();
      return { fileId: uploadData.id, name, updated: false };
    }
  }

  async function listDriveProjects() {
    const folderId = await getOrCreateDriveFolder();
    let q = "trashed=false and (name contains '.vexproj' or name contains '.json')";
    if (folderId) {
      q = `'${folderId}' in parents and trashed=false`;
    }

    const listUrl = "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({
      q: q,
      fields: "files(id, name, modifiedTime, size)",
      orderBy: "modifiedTime desc"
    });

    const res = await fetchWithAuth(listUrl);
    const data = await res.json();
    return data.files || [];
  }

  async function loadProjectFromDrive(fileId) {
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await fetchWithAuth(downloadUrl);
    const json = await res.json();
    return json;
  }

  window.GoogleDriveSync = {
    getAccessToken: getDriveAccessToken,
    saveProject: saveProjectToDrive,
    listProjects: listDriveProjects,
    loadProject: loadProjectFromDrive
  };
})();
