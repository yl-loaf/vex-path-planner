// ============================================================================
// VEX V5 LemLib Suite - Standalone Admin & Member Permissions Dashboard (admin.js)
// ============================================================================
(function() {
  "use strict";

  let currentUser = null;
  let currentTeam = null;
  let firestoreUnsub = null;
  let inviteListenerUnsub = null;

  // --------------------------------------------------------------------------
  // FIREBASE INITIALIZATION & HELPERS
  // --------------------------------------------------------------------------
  function getFirestoreDb() {
    if (typeof firebase !== "undefined" && firebase.firestore) {
      try { return firebase.firestore(); } catch (_) {}
    }
    return null;
  }

  function resolveApiUrl(path) {
    if (typeof window !== "undefined" && typeof window.getApiUrl === "function") {
      return window.getApiUrl(path);
    }
    const host = (window && window.location && window.location.hostname) ? window.location.hostname : "";
    if (host.includes("github.io")) return null;
    return path;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getCleanEmailKeys(email) {
    if (!email) return [];
    const lower = email.toLowerCase().trim();
    const replaced = lower.replace(/[^a-zA-Z0-9]/g, "_");
    const noDots = lower.replace(/\./g, "_dot_").replace(/@/g, "_at_");
    return Array.from(new Set([replaced, noDots]));
  }

  function getRoleColor(role) {
    switch ((role || "").toLowerCase()) {
      case "programmer": return "#38bdf8";
      case "builder": return "#f59e0b";
      case "driver": return "#ef4444";
      case "strategist": return "#a855f7";
      case "coach": return "#10b981";
      case "admin": return "#f59e0b";
      default: return "#94a3b8";
    }
  }

  function generate6DigitHex() {
    const chars = "0123456789ABCDEF";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * 16)];
    }
    return code;
  }

  function showToast(msg, icon = "✅") {
    const toast = document.getElementById("teamToast");
    const tIcon = document.getElementById("teamToastIcon");
    const tMsg = document.getElementById("teamToastMsg");
    if (!toast) return;
    if (tIcon) tIcon.textContent = icon;
    if (tMsg) tMsg.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => { toast.classList.remove("show"); }, 3500);
  }

  function isCurrentUserOwner() {
    if (!currentTeam || !currentUser || !currentUser.email) return false;
    const myEmail = currentUser.email.toLowerCase().trim();
    if (currentTeam.ownerEmail && currentTeam.ownerEmail.toLowerCase().trim() === myEmail) {
      return true;
    }
    const myMember = (currentTeam.members || []).find(m => (m.email || "").toLowerCase().trim() === myEmail);
    return Boolean(myMember && myMember.isOwner);
  }

  function isCurrentUserAdmin() {
    if (!currentTeam || !currentUser || !currentUser.email) return false;
    if (isCurrentUserOwner()) return true;
    const myEmail = currentUser.email.toLowerCase().trim();
    const myMember = (currentTeam.members || []).find(m => (m.email || "").toLowerCase().trim() === myEmail);
    return Boolean(myMember && (myMember.isAdmin || myMember.role === "Admin" || myMember.isOwner));
  }

  // --------------------------------------------------------------------------
  // FIRESTORE SYNC & SAVE
  // --------------------------------------------------------------------------
  async function fsSaveTeamDoc(team) {
    const db = getFirestoreDb();
    if (!team || !team.teamId) return false;
    try {
      if (db) {
        await db.collection("teams").doc(team.teamId).set(team, { merge: true });
        if (team.teamCode) {
          const codeKey = team.teamCode.trim().toUpperCase();
          await db.collection("teams").doc(codeKey).set(team, { merge: true });
        }
      }
      try {
        localStorage.setItem("lemlib_active_team", JSON.stringify(team));
      } catch (_) {}
      return true;
    } catch (e) {
      console.warn("[AdminDashboard] Firestore save notice:", e);
      return false;
    }
  }

  function subscribeTeam(teamId) {
    if (firestoreUnsub) {
      try { firestoreUnsub(); } catch (_) {}
      firestoreUnsub = null;
    }
    const db = getFirestoreDb();
    if (!db || !teamId) return;

    try {
      firestoreUnsub = db.collection("teams").doc(teamId).onSnapshot((doc) => {
        if (doc && doc.exists) {
          const remote = doc.data();
          if (remote) {
            const myEmail = (currentUser?.email || "").toLowerCase().trim();
            if (myEmail && Array.isArray(remote.members) && remote.members.length > 0) {
              const stillMember = remote.members.some(m => (m.email || "").toLowerCase().trim() === myEmail);
              if (!stillMember && !isCurrentUserOwner()) {
                alert("⚠️ You have been removed from this team by an administrator.");
                window.location.href = "team.html";
                return;
              }
            }
            if (remote.updatedAt > (currentTeam?.updatedAt || 0)) {
              currentTeam = remote;
              renderAll();
            }
          }
        }
      });
    } catch (e) {
      console.warn("[AdminDashboard] Live team subscription notice:", e);
    }
  }

  // --------------------------------------------------------------------------
  // FULLSCREEN 6-DIGIT HEX INVITATION NOTIFICATION
  // --------------------------------------------------------------------------
  function listenForPendingInvites(userEmail) {
    if (!userEmail) return;
    if (inviteListenerUnsub) {
      try { inviteListenerUnsub(); } catch (_) {}
      inviteListenerUnsub = null;
    }

    const db = getFirestoreDb();
    const cleanKeys = getCleanEmailKeys(userEmail);

    if (db) {
      // Listen directly to the user's invite document in Firestore
      try {
        const docRef = db.collection("team_invites").doc(cleanKeys[0]);
        inviteListenerUnsub = docRef.onSnapshot((doc) => {
          if (doc && doc.exists) {
            const data = doc.data();
            if (data && data.status === "pending") {
              showFullScreenInviteModal(data);
            }
          }
        });
      } catch (e) {
        console.warn("[AdminDashboard] Invite listener notice:", e);
      }
    }

    // Also poll server API if available
    const apiRoute = resolveApiUrl(`/api/team/invite/pending?email=${encodeURIComponent(userEmail)}`);
    if (apiRoute) {
      fetch(apiRoute).then(r => r.json()).then(data => {
        if (data && Array.isArray(data.pending) && data.pending.length > 0) {
          showFullScreenInviteModal(data.pending[0]);
        }
      }).catch(() => {});
    }
  }

  function showFullScreenInviteModal(invite) {
    const modal = document.getElementById("fullScreenInviteModal");
    if (!modal) return;

    const lblTeam = document.getElementById("lblInvitedTeamName");
    const lblBy = document.getElementById("lblInvitedBy");
    const lblEmail = document.getElementById("lblInvitedUserEmail");
    const grid = document.getElementById("hexOptionsGrid");
    const feedback = document.getElementById("hexVerifyFeedback");

    if (lblTeam) lblTeam.textContent = invite.teamName || "VEX Team";
    if (lblBy) lblBy.textContent = invite.invitedBy || "Team Admin";
    if (lblEmail) lblEmail.textContent = invite.targetEmail || currentUser?.email || "";
    if (feedback) { feedback.textContent = ""; feedback.style.color = ""; }

    const options = Array.isArray(invite.options) && invite.options.length === 3
      ? invite.options
      : [invite.correctHex || "A4B1C2", "8D39FE", "5E04BA"];

    if (grid) {
      grid.innerHTML = "";
      options.forEach(hex => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "hex-option-card";
        btn.innerHTML = `
          <span style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;">Code Option</span>
          <span class="hex-code-val">${escapeHtml(hex)}</span>
        `;

        btn.addEventListener("click", () => handleHexCodeSelection(btn, hex, invite));
        grid.appendChild(btn);
      });
    }

    const btnDecline = document.getElementById("btnDeclineTeamInvite");
    if (btnDecline) {
      btnDecline.onclick = () => {
        if (confirm("Are you sure you want to decline this team invitation?")) {
          declineTeamInvite(invite);
        }
      };
    }

    modal.style.display = "flex";
  }

  async function handleHexCodeSelection(selectedBtn, chosenHex, invite) {
    const feedback = document.getElementById("hexVerifyFeedback");
    const grid = document.getElementById("hexOptionsGrid");
    const allBtns = grid ? grid.querySelectorAll(".hex-option-card") : [];
    allBtns.forEach(b => { b.disabled = true; });

    let isCorrect = false;

    // Verify against server endpoint first if available
    const apiRoute = resolveApiUrl("/api/team/invite/verify");
    if (apiRoute) {
      try {
        const res = await fetch(apiRoute, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamId: invite.teamId,
            inviteId: invite.id,
            email: currentUser?.email,
            selectedHex: chosenHex,
            displayName: currentUser?.displayName,
            role: "Programmer"
          })
        });
        const data = await res.json();
        if (data.success) {
          isCorrect = true;
          if (data.team) {
            localStorage.setItem("lemlib_active_team", JSON.stringify(data.team));
          }
        }
      } catch (_) {}
    }

    // Client-side Firestore verification fallback
    if (!isCorrect && invite.correctHex) {
      isCorrect = (chosenHex.toUpperCase().trim() === invite.correctHex.toUpperCase().trim());
    }

    if (isCorrect) {
      selectedBtn.classList.add("correct");
      if (feedback) {
        feedback.textContent = "✅ Correct authorization code! Joining team workspace...";
        feedback.style.color = "#4ade80";
      }

      // Mark invite accepted in Firestore
      try {
        const db = getFirestoreDb();
        if (db && invite.targetEmail) {
          const cleanKey = getCleanEmailKeys(invite.targetEmail)[0];
          await db.collection("team_invites").doc(cleanKey).update({ status: "accepted", acceptedAt: Date.now() });

          // Add to team roster
          await db.collection("team_rosters").doc(cleanKey).set({
            teamId: invite.teamId,
            email: invite.targetEmail.toLowerCase().trim(),
            teamName: invite.teamName,
            joinedAt: Date.now()
          }, { merge: true });
        }
      } catch (_) {}

      setTimeout(() => {
        const modal = document.getElementById("fullScreenInviteModal");
        if (modal) modal.style.display = "none";
        window.location.href = "team.html";
      }, 1200);
    } else {
      selectedBtn.classList.add("incorrect");
      if (feedback) {
        feedback.textContent = "❌ Incorrect verification code! Invitation declined.";
        feedback.style.color = "#f87171";
      }

      // Mark invite rejected
      try {
        const db = getFirestoreDb();
        if (db && invite.targetEmail) {
          const cleanKey = getCleanEmailKeys(invite.targetEmail)[0];
          await db.collection("team_invites").doc(cleanKey).update({ status: "rejected", rejectedAt: Date.now() });
        }
      } catch (_) {}

      setTimeout(() => {
        const modal = document.getElementById("fullScreenInviteModal");
        if (modal) modal.style.display = "none";
        alert("❌ Incorrect verification code. The team invitation has been declined.");
      }, 1500);
    }
  }

  async function declineTeamInvite(invite) {
    const modal = document.getElementById("fullScreenInviteModal");
    if (modal) modal.style.display = "none";

    const apiRoute = resolveApiUrl("/api/team/invite/decline");
    if (apiRoute) {
      fetch(apiRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: invite.teamId, email: currentUser?.email, inviteId: invite.id })
      }).catch(() => {});
    }

    try {
      const db = getFirestoreDb();
      if (db && invite.targetEmail) {
        const cleanKey = getCleanEmailKeys(invite.targetEmail)[0];
        await db.collection("team_invites").doc(cleanKey).update({ status: "declined", declinedAt: Date.now() });
      }
    } catch (_) {}

    showToast("Team invitation declined.", "ℹ️");
  }

  // --------------------------------------------------------------------------
  // ADMIN DASHBOARD RENDERING
  // --------------------------------------------------------------------------
  function renderAll() {
    renderTeamBanner();
    renderMembersTable();
    renderPendingInvites();
  }

  function renderTeamBanner() {
    if (!currentTeam) {
      document.getElementById("lblBannerTeamName").textContent = "No Active Workspace Selected";
      document.getElementById("lblBannerTeamCode").textContent = "---";
      document.getElementById("lblBannerTeamOtp").textContent = "------";
      document.getElementById("lblBannerMemberCount").textContent = "0";
      return;
    }

    document.getElementById("lblAdminTeamName").textContent = currentTeam.teamName || "Team Admin";
    document.getElementById("lblBannerTeamName").textContent = currentTeam.teamName || "VEX Team Workspace";
    document.getElementById("lblBannerTeamCode").textContent = currentTeam.teamCode || "---";

    const otp = (currentTeam.otpInfo && currentTeam.otpInfo.code) ? currentTeam.otpInfo.code : "AUTH01";
    document.getElementById("lblBannerTeamOtp").textContent = otp;
    document.getElementById("lblBannerMemberCount").textContent = String((currentTeam.members || []).length);

    const isOwner = isCurrentUserOwner();
    const isAdmin = isCurrentUserAdmin();

    const roleBadge = document.getElementById("badgeAdminRole");
    if (roleBadge) {
      if (isOwner) {
        roleBadge.textContent = "OWNER & SUPERADMIN";
        roleBadge.style.background = "#fbbf24";
      } else if (isAdmin) {
        roleBadge.textContent = "ADMINISTRATOR";
        roleBadge.style.background = "#f59e0b";
      } else {
        roleBadge.textContent = "MEMBER (READ-ONLY)";
        roleBadge.style.background = "#64748b";
        roleBadge.style.color = "#ffffff";
      }
    }

    const accessNotice = document.getElementById("adminAccessNotice");
    if (accessNotice) {
      accessNotice.style.display = (!isAdmin) ? "block" : "none";
    }

    const btnSaveAll = document.getElementById("btnAdminSaveAll");
    if (btnSaveAll) {
      btnSaveAll.style.display = (isAdmin) ? "inline-block" : "none";
    }
  }

  function renderMembersTable() {
    const tbody = document.getElementById("adminMembersTableBody");
    if (!tbody || !currentTeam) return;

    const members = currentTeam.members || [];
    const searchVal = (document.getElementById("txtSearchMembers")?.value || "").toLowerCase().trim();
    const canManage = isCurrentUserAdmin();
    const myEmail = (currentUser?.email || "").toLowerCase().trim();

    // Filter members
    const filtered = members.filter(m => {
      if (!searchVal) return true;
      const name = (m.displayName || "").toLowerCase();
      const email = (m.email || "").toLowerCase();
      const role = (m.role || "").toLowerCase();
      return name.includes(searchVal) || email.includes(searchVal) || role.includes(searchVal);
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center;padding:24px;color:var(--muted);font-size:0.85rem;">
            🔍 No teammates matched "${escapeHtml(searchVal)}".
          </td>
        </tr>
      `;
      return;
    }

    const ROLES = ["Programmer", "Builder", "Driver", "Strategist", "Scout", "Coach", "Member"];
    let html = "";

    filtered.forEach((m) => {
      const idx = members.indexOf(m);
      const email = m.email || "member@team";
      const isOwner = m.isOwner || (currentTeam.ownerEmail && currentTeam.ownerEmail.toLowerCase().trim() === email.toLowerCase().trim());
      const isAdmin = m.isAdmin || isOwner;
      const canEdit = m.canEditCode !== undefined ? m.canEditCode : (isAdmin || m.role === "Programmer");
      const isMe = (email.toLowerCase().trim() === myEmail);
      const roleColor = m.color || getRoleColor(m.role);

      let roleSelect = "";
      if (canManage && !isOwner) {
        roleSelect = `
          <select class="sel-member-role form-input" data-idx="${idx}" style="padding:4px 8px;font-size:0.76rem;width:auto;">
            ${ROLES.map(r => `<option value="${r}" ${m.role === r ? 'selected' : ''}>${r}</option>`).join("")}
          </select>
        `;
      } else {
        roleSelect = `<span class="member-role-tag ${m.role ? m.role.toLowerCase() : 'programmer'}" style="background:${roleColor}22;border:1px solid ${roleColor}66;color:${roleColor};padding:3px 8px;border-radius:4px;font-weight:700;">${escapeHtml(m.role || 'Programmer')}</span>`;
      }

      let actionHtml = "";
      if (isOwner) {
        actionHtml = `<span style="font-size:0.75rem;color:#fbbf24;font-weight:800;">👑 Owner</span>`;
      } else if (isMe) {
        actionHtml = `<span style="font-size:0.75rem;color:#94a3b8;">(You)</span>`;
      } else if (canManage) {
        actionHtml = `
          <button type="button" class="btn-kick-member" data-idx="${idx}" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.35);color:#f87171;padding:4px 10px;border-radius:6px;font-size:0.75rem;cursor:pointer;font-weight:700;">
            👢 Kick
          </button>
        `;
      } else {
        actionHtml = `<span style="color:#64748b;font-size:0.75rem;">—</span>`;
      }

      html += `
        <tr style="border-bottom:1px solid #1e293b;">
          <td style="padding:12px 14px;color:#f8fafc;">
            <div style="font-weight:700;display:flex;align-items:center;gap:6px;">
              <span>${escapeHtml(m.displayName || email.split("@")[0])}</span>
              ${isOwner ? '<span title="Team Owner">👑</span>' : ''}
            </div>
            <div style="font-size:0.72rem;color:#64748b;margin-top:2px;">${escapeHtml(email)}</div>
          </td>
          <td style="padding:12px 14px;">
            ${roleSelect}
          </td>
          <td style="padding:12px 14px;">
            <label style="${canManage && !isOwner ? 'cursor:pointer;' : 'cursor:not-allowed;'}display:inline-flex;align-items:center;gap:6px;">
              <input type="checkbox" class="chk-member-admin" data-idx="${idx}" ${isAdmin ? 'checked' : ''} ${!canManage || isOwner ? 'disabled' : ''} />
              <span style="font-size:0.75rem;font-weight:700;color:${isAdmin ? '#f59e0b' : '#94a3b8'};">${isAdmin ? '👑 Admin' : 'Member'}</span>
            </label>
          </td>
          <td style="padding:12px 14px;">
            <select class="sel-member-edit form-input" data-idx="${idx}" ${!canManage ? 'disabled' : ''} style="padding:4px 8px;font-size:0.76rem;width:auto;">
              <option value="true" ${canEdit ? 'selected' : ''}>✏️ Can Edit Code</option>
              <option value="false" ${!canEdit ? 'selected' : ''}>💡 Suggestion Only</option>
            </select>
          </td>
          <td style="padding:12px 14px;text-align:center;">
            ${actionHtml}
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;

    // Attach listeners
    if (canManage) {
      tbody.querySelectorAll(".sel-member-role").forEach(sel => {
        sel.addEventListener("change", (e) => {
          const i = parseInt(e.target.getAttribute("data-idx"), 10);
          if (members[i]) {
            members[i].role = e.target.value;
            members[i].color = getRoleColor(e.target.value);
          }
        });
      });

      tbody.querySelectorAll(".chk-member-admin").forEach(chk => {
        chk.addEventListener("change", (e) => {
          const i = parseInt(e.target.getAttribute("data-idx"), 10);
          if (members[i]) {
            members[i].isAdmin = e.target.checked;
            if (e.target.checked && members[i].canEditCode === undefined) {
              members[i].canEditCode = true;
            }
          }
        });
      });

      tbody.querySelectorAll(".sel-member-edit").forEach(sel => {
        sel.addEventListener("change", (e) => {
          const i = parseInt(e.target.getAttribute("data-idx"), 10);
          if (members[i]) members[i].canEditCode = (e.target.value === "true");
        });
      });

      tbody.querySelectorAll(".btn-kick-member").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          if (!isCurrentUserAdmin()) {
            alert("Only team admins can kick members.");
            return;
          }
          const i = parseInt(e.currentTarget.getAttribute("data-idx"), 10);
          const targetMem = members[i];
          if (!targetMem) return;

          const isTargetOwner = targetMem.isOwner || (currentTeam.ownerEmail && currentTeam.ownerEmail.toLowerCase().trim() === (targetMem.email || "").toLowerCase().trim());
          if (isTargetOwner) {
            alert("Cannot kick the team owner.");
            return;
          }

          const memName = targetMem.displayName || targetMem.email || "this member";
          if (!confirm(`Are you sure you want to kick "${memName}" from the team?\nThey will immediately lose access to the workspace.`)) {
            return;
          }

          const kicked = members.splice(i, 1)[0];
          currentTeam.updatedAt = Date.now();

          // Add history checkpoint
          const now = Date.now();
          currentTeam.versionHistory = currentTeam.versionHistory || [];
          currentTeam.versionHistory.unshift({
            id: "v_" + now + "_kick",
            timestamp: now,
            dateStr: new Date(now).toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            authorEmail: currentUser.email,
            authorName: currentUser.displayName || currentUser.email.split("@")[0],
            authorRole: "Admin",
            actionSummary: `Kicked ${kicked.displayName || kicked.email} from the team`,
            editType: "member_kick"
          });

          // Server-side kick
          const apiRoute = resolveApiUrl("/api/team/kick-member");
          if (apiRoute) {
            fetch(apiRoute, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                teamId: currentTeam.teamId,
                email: currentUser.email,
                targetEmail: kicked.email
              })
            }).catch(() => {});
          }

          // Delete from Firestore team_rosters
          try {
            const db = getFirestoreDb();
            if (db && kicked.email) {
              const cleanKeys = getCleanEmailKeys(kicked.email);
              for (const k of cleanKeys) {
                db.collection("team_rosters").doc(k).delete().catch(() => {});
              }
            }
          } catch (_) {}

          await fsSaveTeamDoc(currentTeam);
          renderAll();
          showToast(`👢 Kicked ${kicked.displayName || kicked.email} from the team.`, "⚠️");
        });
      });
    }
  }

  function renderPendingInvites() {
    const container = document.getElementById("pendingInvitesList");
    if (!container || !currentTeam) return;

    const invites = (currentTeam.invites || []).filter(i => i.status === "pending");
    if (invites.length === 0) {
      container.innerHTML = `<div style="font-size:0.78rem;color:var(--muted);padding:8px 0;">No pending invites. Enter a Gmail address above to invite a new teammate.</div>`;
      return;
    }

    container.innerHTML = "";
    invites.forEach(inv => {
      const card = document.createElement("div");
      card.style.cssText = "background:rgba(255,255,255,0.03);border:1px solid #1e293b;border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;";
      card.innerHTML = `
        <div>
          <div style="font-weight:700;color:#f8fafc;font-size:0.82rem;">${escapeHtml(inv.targetEmail)}</div>
          <div style="font-size:0.72rem;color:var(--muted);margin-top:2px;">
            Invited by ${escapeHtml(inv.invitedBy || 'Admin')} · 
            Code: <strong style="font-family:monospace;color:#4ade80;letter-spacing:1px;">${escapeHtml(inv.correctHex)}</strong>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" class="btn-copy-code btn-team-secondary" style="font-size:0.72rem;padding:3px 8px;">📋 Copy</button>
          <button type="button" class="btn-revoke-inv btn-xs-clean" style="color:#f87171;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);padding:3px 8px;border-radius:4px;font-size:0.72rem;cursor:pointer;font-weight:700;">Revoke</button>
        </div>
      `;

      card.querySelector(".btn-copy-code").addEventListener("click", () => {
        navigator.clipboard?.writeText(inv.correctHex);
        showToast(`Copied code ${inv.correctHex}!`, "📋");
      });

      card.querySelector(".btn-revoke-inv").addEventListener("click", async () => {
        if (!confirm(`Revoke invitation for ${inv.targetEmail}?`)) return;
        inv.status = "revoked";
        currentTeam.updatedAt = Date.now();

        try {
          const db = getFirestoreDb();
          if (db && inv.targetEmail) {
            const cleanKey = getCleanEmailKeys(inv.targetEmail)[0];
            db.collection("team_invites").doc(cleanKey).delete().catch(() => {});
          }
        } catch (_) {}

        await fsSaveTeamDoc(currentTeam);
        renderPendingInvites();
        showToast("Invitation revoked.", "ℹ️");
      });

      container.appendChild(card);
    });
  }

  // --------------------------------------------------------------------------
  // CREATE 6-DIGIT HEX INVITE
  // --------------------------------------------------------------------------
  async function executeCreateHexInvite() {
    if (!currentTeam || !currentUser) {
      alert("Please ensure you are signed in and an active team is loaded.");
      return;
    }
    if (!isCurrentUserAdmin()) {
      alert("Only team administrators and the team owner can generate invites.");
      return;
    }

    const emailInput = document.getElementById("txtNewInviteEmail");
    const targetEmail = emailInput?.value.trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes("@")) {
      alert("Please enter a valid recipient Gmail address.");
      return;
    }

    // Check if already in team
    if ((currentTeam.members || []).some(m => (m.email || "").toLowerCase().trim() === targetEmail)) {
      alert(`${targetEmail} is already a member of this team.`);
      return;
    }

    const correctHex = generate6DigitHex();
    let fake1 = generate6DigitHex();
    while (fake1 === correctHex) fake1 = generate6DigitHex();
    let fake2 = generate6DigitHex();
    while (fake2 === correctHex || fake2 === fake1) fake2 = generate6DigitHex();

    const options = [correctHex, fake1, fake2].sort(() => Math.random() - 0.5);

    const invite = {
      id: "inv_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 6),
      teamId: currentTeam.teamId,
      teamName: currentTeam.teamName,
      teamCode: currentTeam.teamCode,
      correctHex,
      options,
      targetEmail,
      invitedBy: currentUser.displayName || currentUser.email.split("@")[0],
      invitedByEmail: currentUser.email,
      status: "pending",
      createdAt: Date.now()
    };

    // Store in currentTeam
    if (!currentTeam.invites) currentTeam.invites = [];
    currentTeam.invites = currentTeam.invites.filter(i => i.targetEmail !== targetEmail || i.status !== "pending");
    currentTeam.invites.unshift(invite);
    currentTeam.updatedAt = Date.now();

    // Store in Firestore collection team_invites with key cleanEmailKey
    try {
      const db = getFirestoreDb();
      if (db) {
        const cleanKey = getCleanEmailKeys(targetEmail)[0];
        await db.collection("team_invites").doc(cleanKey).set(invite);
      }
    } catch (e) {
      console.warn("[AdminDashboard] Firestore invite write notice:", e);
    }

    // Also call server API
    const apiRoute = resolveApiUrl("/api/team/invite/create");
    if (apiRoute) {
      fetch(apiRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: currentTeam.teamId,
          email: currentUser.email,
          targetEmail
        })
      }).catch(() => {});
    }

    await fsSaveTeamDoc(currentTeam);

    // Show latest invite card
    const card = document.getElementById("latestInviteCard");
    const lblEmail = document.getElementById("lblLatestInviteEmail");
    const lblHex = document.getElementById("lblLatestHexCode");
    if (card && lblEmail && lblHex) {
      lblEmail.textContent = targetEmail;
      lblHex.textContent = correctHex;
      card.style.display = "block";
    }

    const copyBtn = document.getElementById("btnCopyLatestHex");
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard?.writeText(correctHex);
        showToast(`Copied code ${correctHex}!`, "📋");
      };
    }

    if (emailInput) emailInput.value = "";
    renderPendingInvites();
    showToast(`🔐 Generated invite code ${correctHex} for ${targetEmail}!`, "🎉");
  }

  // --------------------------------------------------------------------------
  // SAVE PERMISSIONS BUTTON
  // --------------------------------------------------------------------------
  async function executeSaveAllPermissions() {
    if (!currentTeam) return;
    if (!isCurrentUserAdmin()) {
      alert("Only team administrators and the team owner can modify permissions.");
      return;
    }

    currentTeam.updatedAt = Date.now();

    // Server update
    const apiRoute = resolveApiUrl("/api/team/settings");
    if (apiRoute) {
      fetch(apiRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId: currentTeam.teamId,
          email: currentUser.email,
          members: currentTeam.members,
          teamName: currentTeam.teamName
        })
      }).catch(() => {});
    }

    await fsSaveTeamDoc(currentTeam);
    renderAll();
    showToast("💾 Saved team member roles and permissions!", "✅");
  }

  // --------------------------------------------------------------------------
  // AUTHENTICATION & INITIALIZATION
  // --------------------------------------------------------------------------
  function initAuth() {
    const btnGoogleSignIn = document.getElementById("btnGoogleSignIn");
    const btnSignOut = document.getElementById("btnSignOut");
    const authUser = document.getElementById("authUser");

    if (btnGoogleSignIn) {
      btnGoogleSignIn.addEventListener("click", () => {
        if (typeof firebase === "undefined" || !firebase.auth) {
          alert("Firebase SDK initializing... please try again in a moment.");
          return;
        }
        const provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().signInWithPopup(provider).catch((err) => {
          console.warn("Sign in notice:", err);
          alert("Sign in note: " + (err.message || err));
        });
      });
    }

    if (btnSignOut) {
      btnSignOut.addEventListener("click", () => {
        if (typeof firebase !== "undefined" && firebase.auth) {
          firebase.auth().signOut().then(() => {
            currentUser = null;
            window.location.reload();
          });
        }
      });
    }

    if (typeof firebase !== "undefined" && firebase.auth) {
      firebase.auth().onAuthStateChanged((user) => {
        if (user && !user.isAnonymous) {
          currentUser = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || user.email.split("@")[0],
            photoURL: user.photoURL || ""
          };
          if (authUser) {
            authUser.textContent = currentUser.displayName;
            authUser.hidden = false;
          }
          if (btnGoogleSignIn) btnGoogleSignIn.hidden = true;
          if (btnSignOut) btnSignOut.hidden = false;

          // Check pending invites for this logged in user
          listenForPendingInvites(currentUser.email);
        } else {
          currentUser = null;
          if (authUser) authUser.hidden = true;
          if (btnGoogleSignIn) btnGoogleSignIn.hidden = false;
          if (btnSignOut) btnSignOut.hidden = true;
        }
        loadInitialTeam();
      });
    } else {
      loadInitialTeam();
    }
  }

  function loadInitialTeam() {
    // Read from localStorage
    try {
      const raw = localStorage.getItem("lemlib_active_team");
      if (raw) {
        currentTeam = JSON.parse(raw);
        if (currentTeam && currentTeam.teamId) {
          subscribeTeam(currentTeam.teamId);
        }
      }
    } catch (_) {}

    renderAll();
  }

  // --------------------------------------------------------------------------
  // EVENT LISTENERS & BOOTSTRAP
  // --------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    initAuth();

    document.getElementById("btnGenerateHexInvite")?.addEventListener("click", executeCreateHexInvite);
    document.getElementById("btnAdminSaveAll")?.addEventListener("click", executeSaveAllPermissions);

    // Search filter input
    document.getElementById("txtSearchMembers")?.addEventListener("input", () => {
      renderMembersTable();
    });
  });

})();
