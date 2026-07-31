/*
 * This program is copyright © 2022 Michael Gray and is distributed under the terms of the GNU GPL
 * version 2.0 with a special clarification/exception that permits adapting the program to
 * configure proprietary "back end" software provided that all modifications to the web interface
 * itself remain covered by the GPL.
 * See http://gargoyle-router.com/faq.html#qfoss for more information
 */

var advancedStr=new Object(); //part of i18n
var basicS=new Object(); //part of i18n

function resetData()
{
	// Wireless
	setWirelessCountryVisibility();
	if(geocode == '' || geocode == '(null)')
	{
		// async country detection, no point waiting for this
		detectCountry();
	}
	// LAN
	setUSteerCommsVisibility();
	// WAN
	setModemNetworkVisibility();
	// NetworkOpts
	setPktSteeringVisibility();
	setIgmpVisibility();

	setGlobalVisibility();
}

function saveChanges()
{
	var igmpErrors = proofreadIgmp();
	if(igmpErrors.length > 0)
	{
		alert(igmpErrors.join("\n") + "\n\n" + UI.ErrChanges);
		return;
	}

	var uci = uciOriginal.clone();
	var uciCompare = uciOriginal.clone();

	setControlsEnabled(false, true, UI.WaitSettings);

	var shouldRestartNetwork = false;
	var shouldRegenCachedVars = false;

	// Wireless
	var selWirelessCountry = getSelectedValue('wireless_country');
	if(selWirelessCountry != '00')
	{
		for(x = 0; x < uciWirelessDevs.length; x++)
		{
			uci.set("wireless",uciWirelessDevs[x],"country",selWirelessCountry);
		}
	}
	else
	{
		for(x = 0; x < uciWirelessDevs.length; x++)
		{
			uci.remove("wireless",uciWirelessDevs[x],"country");
		}
	}

	// LAN
	var usteerSec = uci.getAllSectionsOfType('usteer','usteer');
	if(usteerSec.length > 0)
	{
		var selUSteerComms = getSelectedValue('usteer_comms');
		uci.set('usteer', usteerSec[0], 'enabled', selUSteerComms);
	}

	// WAN
	if(byId('use_modem_network').checked)
	{
		var pkg = 'network';
		var sec = 'modem';
		uci.set(pkg,sec,'','interface');
		uci.set(pkg,sec,'ifname',currentWanIf);
		uci.set(pkg,sec,'proto','static');
		uci.set(pkg,sec,'ipaddr',byId('modem_network_ip').value);
		uci.set(pkg,sec,'netmask',byId('modem_network_mask').value);
	}
	else
	{
		uci.removeSection('network','modem');
	}

	// NetworkOpts
	if(num_cpus > 1)
	{
		var selPktSteerOpt = getSelectedValue('pktsteer_opt');
		uci.set('network', 'globals', 'packet_steering', selPktSteerOpt);
	}

	// IGMP Proxy
	var igmpWasEnabled = false;
	if(igmpAvailable)
	{
		var igmpSecs = uci.getAllSectionsOfType('igmpproxy','igmpproxy');
		var igmpSec = igmpSecs.length > 0 ? igmpSecs[0] : '';
		var igmpNowEnabled = byId('igmp_enable').checked;
		igmpWasEnabled = igmpNowEnabled;

		uci.set('igmpproxy', igmpSec, 'enabled', igmpNowEnabled ? '1' : '0');
		uci.set('igmpproxy', igmpSec, 'quickleave', byId('igmp_quickleave').checked ? '1' : '0');

		// wholesale rewrite of phyint sections, same approach doh.js uses for
		// its resolver list -- simpler and safer than diffing in place
		var existingPhyints = uci.getAllSectionsOfType('igmpproxy','phyint');
		existingPhyints.forEach(function(sec) { uci.removeSection('igmpproxy', sec); });

		if(igmpNowEnabled)
		{
			var upstreamName = getSelectedValue('igmp_upstream');
			var upstreamZone = '';
			igmpNetIfaces.forEach(function(iface) { if(iface.name == upstreamName) { upstreamZone = iface.zone; } });

			uci.set('igmpproxy', 'igmp_up', '', 'phyint');
			uci.set('igmpproxy', 'igmp_up', 'network', upstreamName);
			uci.set('igmpproxy', 'igmp_up', 'zone', upstreamZone);
			uci.set('igmpproxy', 'igmp_up', 'direction', 'upstream');
			var altnetVals = byId('igmp_altnet').value.split(/\s+/).filter(function(s){return s != '';});
			uci.createListOption('igmpproxy', 'igmp_up', 'altnet', true);
			uci.set('igmpproxy', 'igmp_up', 'altnet', altnetVals);

			igmpNetIfaces.forEach(function(iface) {
				var cb = byId('igmp_down_' + iface.name);
				if(cb && cb.checked && iface.name != upstreamName)
				{
					var downId = 'igmp_down_' + iface.name;
					uci.set('igmpproxy', downId, '', 'phyint');
					uci.set('igmpproxy', downId, 'network', iface.name);
					uci.set('igmpproxy', downId, 'zone', iface.zone);
					uci.set('igmpproxy', downId, 'direction', 'downstream');
				}
			});
		}
	}

	var restartNetworkCommand = "\nsh /usr/lib/gargoyle/restart_network.sh;\n";
	var regenerateCacheCommand = "\nrm -rf /tmp/cached_basic_vars ;\n/usr/lib/gargoyle/cache_basic_vars.sh >/dev/null 2>/dev/null\n";
	var commands = uci.getScriptCommands(uciCompare);
	var postcommands = "";

	if(commands.match(/wireless\.radio[0-9]+\.country/))
	{
		// Wireless country is changing
		shouldRestartNetwork = true;
		shouldRegenCachedVars = true;
	}
	if(commands.match(/usteer/))
	{
		// USteer is changing
		postcommands = postcommands + "/etc/init.d/usteer restart\n";
	}
	if(commands.match(/network\.modem/))
	{
		// Modem network is being created/destroyed
		shouldRestartNetwork = true;
	}
	if(commands.match(/packet_steering/))
	{
		// Packet steering option is being changed
		shouldRestartNetwork = true;
	}
	if(commands.match(/igmpproxy/))
	{
		// IGMP Proxy settings are changing
		if(igmpWasEnabled)
		{
			postcommands = postcommands + "/etc/init.d/igmpproxy enable\n/etc/init.d/igmpproxy restart\n";
		}
		else
		{
			postcommands = postcommands + "/etc/init.d/igmpproxy stop\n/etc/init.d/igmpproxy disable\n";
		}
	}

	commands = commands + (shouldRestartNetwork ? restartNetworkCommand : '\n') + (shouldRegenCachedVars ? regenerateCacheCommand : '\n') + postcommands;

	var param = getParameterDefinition("commands", commands)  + "&" + getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

	var stateChangeFunction = function(req)
	{
		if(req.readyState == 4)
		{
			uciOriginal = uci.clone();
			resetData();
			setControlsEnabled(true);
		}
	}
	runAjax("POST", "utility/run_commands.sh", param, stateChangeFunction);
}

function arrayMoveIdx(arr, fromIdx, toIdx)
{
	var el = arr[fromIdx];
	arr.splice(fromIdx, 1);
	arr.splice(toIdx, 0, el);
}

function setGlobalVisibility()
{
	var anyVis = 0;
	anyVis += setNetOptContainerVisibility();
	anyVis += setWirelessContainerVisibility();
	anyVis += setLANContainerVisibility();
	anyVis += setWANContainerVisibility();
	byId('no_settings').style.display = anyVis > 0 ? 'none' : 'block';
}

function setWANContainerVisibility()
{
	var wanSec = uciOriginal.get('network','wan');
	var retVal = 0;
	var vis = 'none';
	if(wanSec == 'interface')
	{
		retVal = 1;
		vis = 'block';
	}
	byId('wan_container').style.display = vis;
	return retVal;
}

function setModemNetworkVisibility()
{
	var wandhcp = uciOriginal.get('network','wan','proto');
	if(wandhcp == 'dhcp' || wandhcp == 'pppoe')
	{
		loadChecked(['use_modem_network',uciOriginal,'network','modem','ipaddr',function(ip){return ip != ""}]);
		loadValueFromVariable(['modem_network_ip',uciOriginal,'network','modem','ipaddr','192.168.0.2']);
		loadValueFromVariable(['modem_network_mask',uciOriginal,'network','modem','netmask','255.255.255.0']);
		enableAssociatedField(byId('use_modem_network'), 'modem_network_ip', '192.168.0.2');
		enableAssociatedField(byId('use_modem_network'), 'modem_network_mask', '255.255.255.0');
	}
}

function setLANContainerVisibility()
{
	var usteerpresent = uciOriginal.getAllSectionsOfType('usteer','usteer');
	var retVal = 0;
	var vis = 'none';
	if(usteerpresent.length > 0)
	{
		retVal = 1;
		vis = 'block';
	}
	byId('lan_container').style.display = vis;
	return retVal;
}

function setUSteerCommsVisibility()
{
	var usteerpresent = uciOriginal.getAllSectionsOfType('usteer','usteer');
	var usteerEn = 0;
	var usteerSec = usteerpresent.length > 0 ? usteerpresent[0] : '';
	loadSelectedValueFromVariable(['usteer_comms',uciOriginal,'usteer',usteerSec,'enabled',1]);
}

function setWirelessContainerVisibility()
{
	var wifiifaces = uciOriginal.getAllSectionsOfType('wireless','wifi-iface');
	var retVal = 0;
	var vis = 'none';
	if(wifiifaces.length > 0)
	{
		retVal = 1;
		vis = 'block';
	}
	byId('wireless_container').style.display = vis;
	return retVal;
}

function setWirelessCountryVisibility()
{
	var currentSel = getSelectedValue('wireless_country');
	var countryData = parseCountry(countryLines);
	// If we have detected a country, put this at the top (under the default)
	if(geocode != '')
	{
		var foundIdx = countryData[1].indexOf(geocode);
		if(foundIdx > -1)
		{
			arrayMoveIdx(countryData[1], foundIdx, 1);
			arrayMoveIdx(countryData[0], foundIdx, 1);
		}
	}
	setAllowableSelections('wireless_country', countryData[1], countryData[0]);
	// Set it to the selected value in wireless config, otherwise Default 00 World
	selCountry = uciOriginal.get('wireless','radio0','country');
	selCountry = selCountry == "" ? uciOriginal.get('wireless','radio1','country') : selCountry;
	selCountry = selCountry == "" ? "00" : selCountry;
	// If we already had a selection, set it again
	selCountry = currentSel == "" ? selCountry : currentSel;
	setSelectedValue('wireless_country',selCountry);
}

function setNetOptContainerVisibility()
{
	var retVal = 0;
	var vis = 'none';

	if(num_cpus > 1 || igmpAvailable)
	{
		retVal = 1;
		vis = 'block';
	}
	byId('netopt_container').style.display = vis;

	// sub-blocks are independently gated now that the panel can be shown for
	// either reason
	byId('pktsteer_opt_container').style.display = (num_cpus > 1) ? 'block' : 'none';
	byId('igmp_container').style.display = igmpAvailable ? 'block' : 'none';

	return retVal;
}

function setPktSteeringVisibility()
{
	loadSelectedValueFromVariable(['pktsteer_opt',uciOriginal,'network','globals','packet_steering','1']);
}

function setIgmpVisibility()
{
	if(!igmpAvailable) { return; }

	var igmpSecs = uciOriginal.getAllSectionsOfType('igmpproxy','igmpproxy');
	var igmpSec = igmpSecs.length > 0 ? igmpSecs[0] : '';
	byId('igmp_enable').checked = uciOriginal.get('igmpproxy', igmpSec, 'enabled') == '1';
	byId('igmp_quickleave').checked = uciOriginal.get('igmpproxy', igmpSec, 'quickleave') != '0';

	var phyints = uciOriginal.getAllSectionsOfType('igmpproxy','phyint');
	var curUpstream = '';
	var curDownstream = [];
	phyints.forEach(function(sec) {
		var dir = uciOriginal.get('igmpproxy', sec, 'direction');
		var net = uciOriginal.get('igmpproxy', sec, 'network');
		if(dir == 'upstream') { curUpstream = net; }
		else if(dir == 'downstream') { curDownstream.push(net); }
	});

	var upVals = igmpNetIfaces.map(function(i){return i.name;});
	var upNames = igmpNetIfaces.map(function(i){return i.name;});
	setAllowableSelections('igmp_upstream', upVals, upNames);
	setSelectedValue('igmp_upstream', curUpstream != '' ? curUpstream : (upVals.length > 0 ? upVals[0] : ''));

	// altnet is a real uci list option; uciOriginal.get() returns it as a JS
	// array directly for list-typed keys (same mechanism WireGuard's
	// allowed_ips relies on) -- joined with spaces for the text field.
	var upstreamSec = phyints.filter(function(s){return uciOriginal.get('igmpproxy',s,'direction')=='upstream';})[0];
	var altnets = upstreamSec ? uciOriginal.get('igmpproxy', upstreamSec, 'altnet') : '';
	byId('igmp_altnet').value = (altnets instanceof Array && altnets.length > 0) ? altnets.join(' ') : '0.0.0.0/0';

	// downstream checkboxes, one per candidate interface
	var container = byId('igmp_downstream_container');
	while(container.firstChild) { container.removeChild(container.firstChild); }
	igmpNetIfaces.forEach(function(iface) {
		var wrap = document.createElement('span');
		wrap.className = 'col-xs-4';
		var cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.id = 'igmp_down_' + iface.name;
		cb.checked = curDownstream.indexOf(iface.name) > -1;
		var lbl = document.createElement('label');
		lbl.setAttribute('for', cb.id);
		lbl.className = 'short-left-pad';
		lbl.innerText = iface.name;
		wrap.appendChild(cb);
		wrap.appendChild(lbl);
		container.appendChild(wrap);
	});
}

function validateIgmpAltnet(cidr)
{
	// A dedicated check rather than reusing validateIP(): validateIP()
	// treats 0.0.0.0 as an error (reserved/invalid host address), but
	// 0.0.0.0/0 -- meaning "any source" -- is the recommended default value
	// for this field and a completely valid CIDR network address.
	var m = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
	if(m == null) { return false; }
	for(var i = 1; i <= 4; i++)
	{
		if(parseInt(m[i], 10) > 255) { return false; }
	}
	var prefix = parseInt(m[5], 10);
	return prefix >= 0 && prefix <= 32;
}

function proofreadIgmp()
{
	var errors = [];
	if(!igmpAvailable || !byId('igmp_enable').checked)
	{
		return errors;
	}

	var upstreamName = getSelectedValue('igmp_upstream');
	if(upstreamName == '')
	{
		errors.push(advancedStr.IgmpErrNoUp);
	}

	var downstreamChecked = igmpNetIfaces.filter(function(iface) {
		var cb = byId('igmp_down_' + iface.name);
		return cb && cb.checked;
	});
	if(downstreamChecked.length == 0)
	{
		errors.push(advancedStr.IgmpErrNoDown);
	}
	else if(downstreamChecked.some(function(iface){return iface.name == upstreamName;}))
	{
		errors.push(advancedStr.IgmpErrSameIf);
	}

	var altnetVals = byId('igmp_altnet').value.split(/\s+/).filter(function(s){return s != '';});
	if(altnetVals.length == 0 || altnetVals.some(function(s){return !validateIgmpAltnet(s);}))
	{
		errors.push(advancedStr.IgmpErrAltNet);
	}

	return errors;
}

function parseCountry(countryLines)
{
	countryData = [[],[]];

	for(lineIndex = 0; lineIndex < countryLines.length; lineIndex++)
	{
		line = countryLines[lineIndex];
		if(!line.match(/^[\t]*#/) && line.length > 0)
		{
			splitLine = line.split(/[\t]+/);
			name = stripQuotes(splitLine.pop());
			code = stripQuotes(splitLine.pop());

			countryData[0].push(name);
			countryData[1].push(code);
		}
	}

	return countryData;
}

function parseCountryDetection(detected)
{
	var lines = detected.split('\n');
	lines.forEach(function(line) {
		if(line.match(/ip: /))
		{
			geoip = line.replace(/ip: /,'');
		}
		else if(line.match(/country_code: /))
		{
			geocode = line.replace(/country_code: /,'');
		}
	});
}

function detectCountry()
{
	commands = "gipquery -g 2>/dev/null > /tmp/cached_detected_country;cat /tmp/cached_detected_country;";

	var param = getParameterDefinition("commands", commands)  + "&" + getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

	var stateChangeFunction = function(req)
	{
		if(req.readyState == 4)
		{
			parseCountryDetection(req.responseText.replace(/Success/,''));
			setWirelessCountryVisibility();
		}
	}
	runAjax("POST", "utility/run_commands.sh", param, stateChangeFunction);
}
