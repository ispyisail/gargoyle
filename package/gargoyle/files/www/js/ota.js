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

function otaSaveAutocheck()
{
	var enabled = document.getElementById("ota_autocheck").checked ? "1" : "0";
	var commands = "uci set gargoyle.ota.autocheck=" + enabled + "\nuci commit gargoyle";
	var param = getParameterDefinition("commands", commands) + "&" + otaHashParam();
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
