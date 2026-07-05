/*
 * safe_apply.js -- client half of the snapshot+watchdog+auto-revert safety
 * net for network changes that can sever the admin's own access to the
 * router. Pages that touch WAN/LAN VLAN state (basic.js, vlan.js) call
 * safeApplyRun() instead of posting straight to utility/run_commands.sh.
 *
 * The pending-apply marker is kept in localStorage (not just this page's
 * JS state) so the confirmation survives a full page reload or a new tab --
 * the only proof of reachability that matters is a fresh HTTP round trip,
 * and the modal needs to reappear on whatever page the admin lands on next.
 */

var saS = new Object(); // part of i18n

var safeApplyCountdownTimer = null;
var safeApplyPollTimer = null;

// opts.onApplied(req), if given, fires once the initial apply has completed
// server-side (same "readyState == 4" moment a plain runAjax(...
// utility/run_commands.sh ...) callback would fire) -- this is what lets a
// caller like basic.js's saveChanges() keep its existing "refresh
// uciOriginal, re-enable controls" logic without having to know anything
// about the confirm/watchdog flow that follows. It fires whether the apply
// succeeded, was busy, or failed, matching how callers already treat the
// plain run_commands.sh response today (unconditionally re-enabling the UI).
function safeApplyRun(commands, opts)
{
	opts = opts || {};
	var timeout = opts.timeout || 45;

	var param = getParameterDefinition("commands", commands) + "&" +
	            getParameterDefinition("timeout", "" + timeout) + "&" +
	            getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

	var stateChangeFunction = function(req)
	{
		if(req.readyState == 4)
		{
			var idMatch = req.responseText.match(/apply_id=(\S+)/);
			var timeoutMatch = req.responseText.match(/timeout=(\d+)/);
			if(idMatch === null)
			{
				// "Busy: ..." or "Failure: ..." -- nothing was applied.
				window.alert(req.responseText);
				if(opts.onApplied) { opts.onApplied(req); }
				return;
			}
			var applyId = idMatch[1];
			var actualTimeout = timeoutMatch !== null ? parseInt(timeoutMatch[1]) : timeout;

			localStorage.setItem("gargoylePendingSafeApply", JSON.stringify({
				id: applyId,
				until: Date.now() + actualTimeout*1000
			}));

			showSafeApplyModal(applyId, actualTimeout);
			if(opts.onApplied) { opts.onApplied(req); }
		}
	}
	runAjax("POST", "utility/safe_apply_run.sh", param, stateChangeFunction);
}

function showSafeApplyModal(applyId, secondsRemaining)
{
	openModalWindow("safe_apply_confirm_modal");
	startSafeApplyCountdown(applyId, secondsRemaining);
}

function startSafeApplyCountdown(applyId, secondsRemaining)
{
	if(safeApplyCountdownTimer !== null) { clearInterval(safeApplyCountdownTimer); }
	if(safeApplyPollTimer !== null) { clearTimeout(safeApplyPollTimer); }

	var remaining = secondsRemaining;
	var countdownEl = document.getElementById("safe_apply_countdown");
	if(countdownEl) { countdownEl.textContent = remaining; }

	safeApplyCountdownTimer = setInterval(function() {
		remaining--;
		if(countdownEl) { countdownEl.textContent = Math.max(remaining, 0); }
		if(remaining <= 0)
		{
			clearInterval(safeApplyCountdownTimer);
			safeApplyCountdownTimer = null;
			var revertingEl = document.getElementById("safe_apply_reverting");
			if(revertingEl) { revertingEl.style.display = ""; }
			// Give the server-side watchdog a few seconds to actually finish
			// the restore + service restarts before we reload -- the timeout
			// firing client-side just means "no confirmation was sent by
			// now", not "the router has already finished reverting".
			setTimeout(function() { window.location.href = window.location.href; }, 8*1000);
		}
	}, 1000);

	// Same hidden-iframe reachability idiom utility/reboot_test.sh /
	// js/reboot.js already use -- proves a real HTTP round trip happened,
	// not just that a cached response satisfied an XHR.
	var pollAgain = function() {
		var frame = document.getElementById("safe_apply_test");
		if(frame) { frame.src = "utility/safe_apply_status.sh"; }
		safeApplyPollTimer = setTimeout(pollAgain, 3*1000);
	}
	safeApplyPollTimer = setTimeout(pollAgain, 3*1000);
}

function confirmSafeApply()
{
	var pending = JSON.parse(localStorage.getItem("gargoylePendingSafeApply") || "null");
	if(!pending) { return; }

	var param = getParameterDefinition("id", pending.id) + "&" +
	            getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

	var stateChangeFunction = function(req)
	{
		if(req.readyState == 4)
		{
			localStorage.removeItem("gargoylePendingSafeApply");
			if(safeApplyCountdownTimer !== null) { clearInterval(safeApplyCountdownTimer); safeApplyCountdownTimer = null; }
			if(safeApplyPollTimer !== null) { clearTimeout(safeApplyPollTimer); safeApplyPollTimer = null; }
			closeModalWindow("safe_apply_confirm_modal");
		}
	}
	runAjax("POST", "utility/safe_apply_confirm.sh", param, stateChangeFunction);
}

function abortSafeApply()
{
	var pending = JSON.parse(localStorage.getItem("gargoylePendingSafeApply") || "null");
	if(!pending) { return; }

	if(!window.confirm(saS.ConfirmUndo)) { return; }

	var param = getParameterDefinition("id", pending.id) + "&" +
	            getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

	var stateChangeFunction = function(req)
	{
		if(req.readyState == 4)
		{
			localStorage.removeItem("gargoylePendingSafeApply");
			// The router is reverting network/firewall right now -- same
			// wait-then-reload discipline as the timeout-expiry path above.
			setTimeout(function() { window.location.href = window.location.href; }, 8*1000);
		}
	}
	runAjax("POST", "utility/safe_apply_abort.sh", param, stateChangeFunction);
}

// Called from resetData()/page-load on every authenticated page that
// includes safe_apply.js (not just the page the change was made on) -- this
// is what makes the confirmation modal reappear after a reload/new tab, not
// just while the original tab that submitted the change stays open.
function checkPendingSafeApply()
{
	var pending = JSON.parse(localStorage.getItem("gargoylePendingSafeApply") || "null");
	if(!pending) { return; }

	var remaining = Math.round((pending.until - Date.now()) / 1000);
	if(remaining > 0)
	{
		// Reachable enough to load this page at all -- but that's not the
		// same as the admin having reviewed and accepted the change, so this
		// only re-shows the modal for an explicit confirm/undo, it does not
		// auto-confirm on their behalf.
		showSafeApplyModal(pending.id, remaining);
	}
	else
	{
		// Window already elapsed -- the watchdog has already reverted (or is
		// about to); the marker is stale, discard it rather than re-showing
		// a countdown that would just read 0.
		localStorage.removeItem("gargoylePendingSafeApply");
	}
}
