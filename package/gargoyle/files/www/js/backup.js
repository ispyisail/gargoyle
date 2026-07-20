/*
 * This program is copyright © 2008-2013 Eric Bishop and is distributed under the terms of the GNU GPL
 * version 2.0 with a special clarification/exception that permits adapting the program to
 * configure proprietary "back end" software provided that all modifications to the web interface
 * itself remain covered by the GPL.
 * See http://gargoyle-router.com/faq.html#qfoss for more information
 */
var bkS=new Object(); //part of i18n

var toggleReload = false;
var globalLanIp;

function getBackup()
{
	setControlsEnabled(false, true, bkS.PrepBack);
	var param = getParameterDefinition("commands", "sh /usr/lib/gargoyle/create_backup.sh ;\n" )  + "&" + getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

	var stateChangeFunction = function(req)
	{
		if(req.readyState == 4)
		{
			setControlsEnabled(true);
			window.location="/dump_backup_tarball.sh"
		}
	}
	runAjax("POST", "utility/run_commands.sh", param, stateChangeFunction);
}

/* --- Settings Profile (RFC #97) ------------------------------------- */

function getProfile()
{
	// export generates and streams in one GET (see profile_export.sh)
	window.location = "utility/profile_export.sh";
}

function importProfile()
{
	if(document.getElementById('profile_file').value.length == 0)
	{
		alert(bkS.ProfSelErr);
		return;
	}
	if( !window.confirm(bkS.ProfImpConfirm) )
	{
		return;
	}
	document.getElementById('profile_import_hash').value = document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, "");
	document.getElementById('profile_import_form').submit();
	setControlsEnabled(false, true, bkS.ProfImping);
}

function profileImportFailed()
{
	setControlsEnabled(true);
	alert(bkS.ProfImpErr);
}

// Called from the hidden import iframe with the parsed report object.
function profileImportComplete(report)
{
	setControlsEnabled(true);

	var container = document.getElementById("profile_import_report");
	while(container.firstChild) { container.removeChild(container.firstChild); }

	var s = report && report.summary ? report.summary : { applied:0, adapted:0, deferred:0, dropped:0 };
	var summary = document.createElement("div");
	summary.className = "col-xs-12";
	var needsReview = (s.adapted + s.deferred + s.dropped);
	var msg = document.createElement("p");
	msg.appendChild(document.createTextNode(
		bkS.ProfResult
			.replace(/%applied%/, s.applied)
			.replace(/%review%/, needsReview) ));
	summary.appendChild(msg);
	container.appendChild(summary);

	var entries = (report && report.entries) ? report.entries : [];
	if(entries.length > 0)
	{
		var wrap = document.createElement("div");
		wrap.className = "col-xs-12 table-responsive";
		var table = document.createElement("table");
		table.className = "table table-condensed";
		var thead = document.createElement("thead");
		var htr = document.createElement("tr");
		[ bkS.ProfColFeat, bkS.ProfColField, bkS.ProfColOutcome, bkS.ProfColReason ].forEach(function(h)
		{
			var th = document.createElement("th");
			th.appendChild(document.createTextNode(h));
			htr.appendChild(th);
		});
		thead.appendChild(htr);
		table.appendChild(thead);

		var tbody = document.createElement("tbody");
		var rowClass = { applied:"success", adapted:"warning", deferred:"info", dropped:"danger" };
		var outcomeLabel = { applied:bkS.ProfOutApplied, adapted:bkS.ProfOutAdapted, deferred:bkS.ProfOutDeferred, dropped:bkS.ProfOutDropped };
		entries.forEach(function(e)
		{
			var tr = document.createElement("tr");
			if(rowClass[e.outcome]) { tr.className = rowClass[e.outcome]; }
			[ e.feature, e.field, (outcomeLabel[e.outcome] || e.outcome), (e.reason || "") ].forEach(function(cell)
			{
				var td = document.createElement("td");
				td.appendChild(document.createTextNode(cell));
				tr.appendChild(td);
			});
			tbody.appendChild(tr);
		});
		table.appendChild(tbody);
		wrap.appendChild(table);
		container.appendChild(wrap);
	}

	container.style.display = "";
}

function doRestore()
{
	if(document.getElementById('restore_file').value.length == 0)
	{
		alert(bkS.SelCErr);
	}
	else
	{
		confirmRestore = window.confirm(bkS.EraseWarn);
		if(confirmRestore)
		{
			document.getElementById('restore_hash').value = document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, "");
			document.getElementById('restore_form').submit();
			setControlsEnabled(false, true, bkS.UpingC);
		}
	}
}
function doDefaultRestore()
{
	var confirmRestore = window.confirm(bkS.EraseWarn);
	if(confirmRestore)
	{
		document.getElementById('restore_original_hash').value = document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, "");
		document.getElementById('restore_original_form').submit();
		setControlsEnabled(false, true, bkS.LdOrig);
	}

}
function restoreFailed()
{
	setControlsEnabled(true);
	alert(bkS.FailErr);
}

function restoreSuccessful(lanIp)
{
	setControlsEnabled(false, true, UI.waitText)

	globalLanIp = lanIp;

	var param = getParameterDefinition("commands", "sh /usr/lib/gargoyle/reboot.sh ;\n" )  + "&" + getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

	var stateChangeFunction = function(req) { return 0; } ;
	runAjax("POST", "utility/run_commands.sh", param, stateChangeFunction);

	//test for router coming back up
	currentProtocol = location.href.match(/^https:/) ? "https" : "http";
	testLocation = currentProtocol + "://" + globalLanIp + ":" + window.location.port + "/utility/reboot_test.sh";
	testReboot = function()
	{
		toggleReload = true;
		setTimeout( "testReboot()", 5*1000);  //try again after 5 seconds
		document.getElementById("reboot_test").src = testLocation;
	}
	setTimeout( "testReboot()", 25*1000);  //start testing after 25 seconds
	setTimeout( "reloadPage()", 240*1000); //after 4 minutes, try to reload anyway
}

function reboot(lanIp)
{
	setControlsEnabled(false, true, UI.waitText)

	globalLanIp = lanIp;

	currentProtocol = location.href.match(/^https:/) ? "https" : "http";
	testLocation = currentProtocol + "://" + globalLanIp + ":" + window.location.port + "/utility/reboot_test.sh";
	testReboot = function()
	{
		toggleReload = true;
		setTimeout( "testReboot()", 5*1000);
		document.getElementById("reboot_test").src = testLocation;
	}
	setTimeout( "testReboot()", 25*1000);
	setTimeout( "reloadPage()", 240*1000);
}

function reloadPage()
{
	if(toggleReload)
	{
		//IE calls onload even when page isn't loaded -- it just times out and calls it anyway
		//We can test if it's loaded for real by looking at the (IE only) readyState property
		//For Browsers NOT designed by dysfunctional cretins whose mothers were a pack of sewer-dwelling, shit-eating rodents,
		//well, for THOSE browsers, readyState (and therefore reloadState) should be null
		var reloadState = document.getElementById("reboot_test").readyState;
		if( typeof(reloadState) == "undefined" || reloadState == null || reloadState == "complete")
		{
			toggleReload = false;
			document.getElementById("reboot_test").src = "";
			currentProtocol = location.href.match(/^https:/) ? "https" : "http";
			window.location = currentProtocol + "://" + globalLanIp + ":" + window.location.port + window.location.pathname;
		}
	}
}
