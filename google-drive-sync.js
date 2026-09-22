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
    provider.setCustomParameters({ prompt: "consent" });

    const result = await firebase.auth().signInWithPopup(provider);
    if (!result.credential || !result.credential.accessToken) {
      throw new Error("Failed to obtain Google Drive authorization token.");
    }

    driveAccessToken = result.credential.accessToken;
    // OAuth access tokens typically expire in 3600s (1 hour)
    driveTokenExpiry = Date.now() + 3500 * 1000;
    localStorage.setItem("gdrive_access_token", driveAccessToken);
    localStorage.setItem("gdrive_token_expiry", driveTokenExpiry);

    return driveAccessToken;
  }

  async function getOrCreateDriveFolder(token) {
    const searchUrl = "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.folder' and name='VEX Path Planner' and trashed=false",
      fields: "files(id, name)"
    });

    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!searchRes.ok) {
      throw new Error("Failed to search Google Drive folders: " + searchRes.statusText);
    }

    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }

    // Create 'VEX Path Planner' folder
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "VEX Path Planner",
        mimeType: "application/vnd.google-apps.folder"
      })
    });

    if (!createRes.ok) {
      throw new Error("Failed to create 'VEX Path Planner' folder in Google Drive.");
    }

    const createData = await createRes.json();
    return createData.id;
  }

  async function saveProjectToDrive(projectData, customFilename = null) {
    const token = await getDriveAccessToken();
    const folderId = await getOrCreateDriveFolder(token);

    const name = customFilename || (projectData.name ? `${projectData.name}.vexproj.json` : "MyVEXProject.vexproj.json");
    const content = JSON.stringify(projectData, null, 2);

    // Check if file already exists in folder
    const q = `'${folderId}' in parents and name='${name}' and trashed=false`;
    const checkUrl = "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({ q, fields: "files(id, name)" });
    const checkRes = await fetch(checkUrl, { headers: { Authorization: `Bearer ${token}` } });
    const checkData = await checkRes.json();

    let fileId = null;
    if (checkData.files && checkData.files.length > 0) {
      fileId = checkData.files[0].id;
    }

    if (fileId) {
      // Update existing file
      const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
      const updateRes = await fetch(updateUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: content
      });

      if (!updateRes.ok) {
        throw new Error("Failed to update project file in Google Drive.");
      }

      return { fileId, name, updated: true };
    } else {
      // Create new multipart file upload
      const metadata = {
        name: name,
        parents: [folderId],
        mimeType: "application/json"
      };

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
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`
        },
        body: multipartRequestBody
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to save new project file to Google Drive.");
      }

      const uploadData = await uploadRes.json();
      return { fileId: uploadData.id, name, updated: false };
    }
  }

  async function listDriveProjects() {
    const token = await getDriveAccessToken();
    const folderId = await getOrCreateDriveFolder(token);

    const q = `'${folderId}' in parents and trashed=false`;
    const listUrl = "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({
      q: q,
      fields: "files(id, name, modifiedTime, size)",
      orderBy: "modifiedTime desc"
    });

    const res = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error("Failed to list files from Google Drive.");
    }

    const data = await res.json();
    return data.files || [];
  }

  async function loadProjectFromDrive(fileId) {
    const token = await getDriveAccessToken();
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

    const res = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error("Failed to download project from Google Drive.");
    }

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
