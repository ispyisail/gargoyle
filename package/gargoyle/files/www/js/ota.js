/*
 * RFC #62 signed OTA firmware upgrade -- System > Update page panel.
 * Companion to update.js (manual upload), which this file deliberately
 * does not touch: this only adds a new panel above it. reloadTarget/
 * testReboot/reloadPage/upgraded() are update.js's own reboot-wait
 * machinery, reused as-is once an apply has been launched -- the "wait for
 * the router to come back, then reload" problem is identical either way.
 */
var otaStr=new Object();

var otaPollTimer = null;
var otaLastCheck = {};

function otaParseKV(text)
{
	var obj = {};
	(text || "").split("\n").forEach(function(line)
	{
		var eq = line.indexOf("=");
		if(eq > 0)
		{
			obj[line.substring(0, eq)] = line.substring(eq + 1);
		}
	});
	return obj;
}

function otaHashParam()
{
	return getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));
}

function otaResetData()
{
	var channel = uciOriginal.get("gargoyle", "ota", "channel");
	document.getElementById("ota_channel").value = channel == "testing" ? "testing" : "stable";
	otaShowChannelWarning();

	var autocheck = uciOriginal.get("gargoyle", "ota", "autocheck");
	document.getElementById("ota_autocheck").checked = autocheck == "1";

	otaSetPanel("idle");
	otaSurfaceLastResult();
}

// No cross-page "update available" badge exists anywhere in Gargoyle's
// header/nav (checked: the sidebar is static, server-rendered per page
// load by gargoyle_header_footer.c, with no dynamic-count/badge mechanism
// to hook into -- adding one means changing that C source, which every
// single page depends on, well beyond what an opt-in autocheck toggle
// should risk). The reachable middle ground: if autocheck's last run (or
// any prior check) already found an update, surface it here the moment
// this page loads, instead of making the user click "Check" again to see
// what autocheck already knows.
function otaSurfaceLastResult()
{
	var param = otaHashParam();
	runAjax("POST", "utility/ota_status.sh", param, function(req)
	{
		if(req.readyState == 4)
		{
			var s = otaParseKV(req.responseText);
			if(s.state == "available")
			{
				otaCheck();
			}
		}
	});
}

function otaShowChannelWarning()
{
	var testing = document.getElementById("ota_channel").value == "testing";
	byId("ota_testing_warning").style.display = testing ? "block" : "none";
}

function otaSaveChannel()
{
	otaShowChannelWarning();
	var channel = document.getElementById("ota_channel").value;
	var commands = "uci set gargoyle.ota.channel=" + channel + "\nuci commit gargoyle";
	var param = getParameterDefinition("commands", commands) + "&" + otaHashParam();
	runAjax("POST", "utility/run_commands.sh", param, function(req)
	{
		if(req.readyState == 4)
		{
			otaSetPanel("idle");
		}
	});
}

// Cron line management follows plugin-gargoyle-ping-watchdog's js/
// ping_watchdog.js saveChanges() idiom exactly: grep-filter the target
// script's own line out of /etc/crontabs/root into a temp file, append a
// fresh line only if enabling, move the temp file back, restart cron.
// Never downloads or flashes anything -- ota_upgrade check only reports.
function otaSaveAutocheck()
{
	var enabled = document.getElementById("ota_autocheck").checked;
	var commands = [];
	commands.push("uci set gargoyle.ota.autocheck=" + (enabled ? "1" : "0"));
	commands.push("uci commit gargoyle");
	commands.push("mkdir -p /etc/crontabs");
	commands.push("touch /etc/crontabs/root");
	commands.push("cat /etc/crontabs/root | grep -v \"ota_upgrade check\" > /tmp/tmp.cron");
	if(enabled)
	{
		// Minute/hour picked fresh each time autocheck is (re-)enabled --
		// spreads routers across the day so they don't all hit the
		// manifest server at the same moment; not meant to be stable
		// across a disable/re-enable cycle, just non-simultaneous. Uses
		// $$ (own PID) + epoch seconds, NOT $RANDOM -- verified live on a
		// real router that this busybox ash build has no $RANDOM support
		// at all (silently expands empty, which would have scheduled
		// every router at midnight, exactly defeating the point).
		commands.push("P=$$; T=$(date +%s); MIN=$(( (P + T) % 60 )); HOUR=$(( (P + T / 60) % 24 )); echo \"$MIN $HOUR * * * /usr/sbin/ota_upgrade check >/dev/null 2>&1\" >>/tmp/tmp.cron");
	}
	commands.push("mv /tmp/tmp.cron /etc/crontabs/root");
	commands.push("/etc/init.d/cron restart");

	var param = getParameterDefinition("commands", commands.join("\n")) + "&" + otaHashParam();
	runAjax("POST", "utility/run_commands.sh", param, function(req) {});
}

// otaSetPanel() shows exactly one of the named result blocks inside
// #ota_result and hides the rest -- simpler than juggling classList calls
// at every call site for a handful of mutually-exclusive states.
function otaSetPanel(which)
{
	["idle", "checking", "available", "uptodate", "notlisted", "eol", "custom", "error", "progress"].forEach(function(name)
	{
		var el = byId("ota_panel_" + name);
		if(el) { el.style.display = (name == which) ? "block" : "none"; }
	});
}

function otaCheck()
{
	otaSetPanel("checking");
	var param = otaHashParam();
	runAjax("POST", "utility/ota_check.sh", param, function(req)
	{
		if(req.readyState == 4)
		{
			otaLastCheck = otaParseKV(req.responseText);
			otaRenderCheckResult();
		}
	});
}

function otaRenderCheckResult()
{
	var r = otaLastCheck;
	switch(r.result)
	{
		case "update-available":
			setChildText("ota_available_version", r.version || "");
			var changelog = byId("ota_available_changelog");
			if(r.changelog)
			{
				changelog.href = r.changelog;
				changelog.style.display = "";
			}
			else
			{
				changelog.style.display = "none";
			}
			otaSetPanel("available");
			break;
		case "up-to-date":
			setChildText("ota_uptodate_version", r.version || "");
			otaSetPanel("uptodate");
			break;
		case "not-listed":
			otaSetPanel("notlisted");
			break;
		case "eol":
			setChildText("ota_eol_final_version", r.final_version || "");
			setChildText("ota_eol_note", r.note || "");
			otaSetPanel("eol");
			break;
		case "custom-build":
			setChildText("ota_custom_note", r.note || "");
			otaSetPanel("custom");
			break;
		default:
			setChildText("ota_error_detail", r.error || r.detail || otaStr.UnknownErr);
			otaSetPanel("error");
			break;
	}
}

function otaStartDownload()
{
	otaSetPanel("progress");
	setChildText("ota_progress_state", otaStr.Starting);
	var param = otaHashParam();
	runAjax("POST", "utility/ota_download.sh", param, function(req)
	{
		if(req.readyState == 4)
		{
			otaPollStatus();
		}
	});
}

function otaPollStatus()
{
	if(otaPollTimer) { clearTimeout(otaPollTimer); otaPollTimer = null; }
	var param = otaHashParam();
	runAjax("POST", "utility/ota_status.sh", param, function(req)
	{
		if(req.readyState != 4) { return; }
		var s = otaParseKV(req.responseText);
		otaRenderProgress(s);
		if(s.state == "ready")
		{
			setChildText("ota_progress_state", otaStr.ReadyToInstall);
			byId("ota_install_button").disabled = false;
		}
		else if(s.state == "failed")
		{
			setChildText("ota_error_detail", s.detail || otaStr.DownloadFailed);
			otaSetPanel("error");
		}
		else
		{
			otaPollTimer = setTimeout("otaPollStatus()", 2000);
		}
	});
}

function otaRenderProgress(s)
{
	var labels = {
		"checking":    otaStr.PgChecking,
		"downloading": otaStr.PgDownloading,
		"validating":  otaStr.PgValidating,
		"verifying":   otaStr.PgVerifying,
		"ready":       otaStr.ReadyToInstall,
		"applying":    otaStr.PgApplying
	};
	setChildText("ota_progress_state", labels[s.state] || s.state || "");
}

function otaInstall(mode)
{
	var warn = mode == "clean" ? otaStr.ConfirmClean : otaStr.ConfirmInstall;
	if(!window.confirm(warn)) { return; }

	byId("ota_install_button").disabled = true;
	byId("ota_install_clean_button").disabled = true;
	setChildText("ota_progress_state", otaStr.PgApplying);

	var curIp = uciOriginal.get("network", "lan", "ipaddr");
	curIp = curIp == "" ? "192.168.1.1" : curIp;
	var curProto = location.href.match(/^https:/) ? "https" : "http";
	reloadTarget = curProto + "://" + curIp + "/";

	var param = otaHashParam() + "&" + getParameterDefinition("mode", mode || "");
	runAjax("POST", "utility/ota_apply.sh", param, function(req)
	{
		if(req.readyState == 4)
		{
			if(otaPollTimer) { clearTimeout(otaPollTimer); otaPollTimer = null; }
			// Reuses update.js's own manual-upgrade reboot-wait sequence --
			// same problem (router is about to flash + reboot), same fix.
			upgraded();
		}
	});
}
