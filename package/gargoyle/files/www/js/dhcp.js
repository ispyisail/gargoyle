/*
 * This program is copyright © 2008-2013 Eric Bishop and is distributed under the terms of the GNU GPL
 * version 2.0 with a special clarification/exception that permits adapting the program to
 * configure proprietary "back end" software provided that all modifications to the web interface
 * itself remain covered by the GPL.
 * See http://gargoyle-router.com/faq.html#qfoss for more information
 */

var dhcpS=new Object(); //part of i18n
var TSort_Data = new Array ('devices_table', 's', 's', 'p', 's', 's', 's', '');

function saveChanges()
{
	errorList = proofreadAll();
	if(errorList.length > 0)
	{
		errorString = errorList.join("\n") + "\n\n"+UI.ErrChanges;
		alert(errorString);
	}
	else
	{
		// Guardrail for the alternative-gateway trap (discussion #48 P4):
		// clients routed through another box send their internet traffic
		// AROUND this router, so bandwidth monitoring, quotas, restrictions
		// and QoS silently stop applying to them. Make the user confirm that
		// in plain language ONCE -- when the feature is being newly enabled
		// -- not on every subsequent save of an already-confirmed setup.
		if(document.getElementById("dhcp_use_alt_gateway").checked && document.getElementById('alt_gateway').value != defaultAltGateway)
		{
			var cfSection = getDhcpSection(uciOriginal);
			var cfOpts = uciOriginal.get('dhcp', cfSection, 'dhcp_option');
			cfOpts = (cfOpts == null || cfOpts == '') ? [] : (Array.isArray(cfOpts) ? cfOpts : [cfOpts]);
			var cfHadAltGw = false;
			var cfi;
			for(cfi = 0; cfi < cfOpts.length; cfi++)
			{
				cfHadAltGw = cfHadAltGw || ((("" + cfOpts[cfi]).split(","))[0] == '3');
			}
			if( (!cfHadAltGw) && (!confirm(dhcpS.AltGWConfirm)) )
			{
				return;
			}
		}

		setControlsEnabled(false, true);

		var staticHostCommands = [];

		// Match existing sections to current-table rows by MAC (a stable
		// identity) instead of unconditionally deleting every section this
		// tab's uciOriginal knows about and rebuilding all of them fresh by
		// row position. The old approach meant any save from this page
		// rewrote every device wholesale from whatever this tab's own
		// (possibly stale) table showed: if a second tab had already saved
		// an edit to a device this tab never touched, that edit got
		// silently reverted the moment this tab saved anything at all, with
		// no warning anywhere (the long-reported multi-tab corruption bug).
		// Reusing a matched section and relying on uci.getScriptCommands()'s
		// normal per-field diff means a save only touches fields this tab
		// actually changed, exactly like every other page already behaves.
		var existingHostSections = uciOriginal.getAllSectionsOfType("dhcp", "host");
		var macToSection = {};
		var maxDeviceIndex = 0;
		for(var esIdx = 0; esIdx < existingHostSections.length; esIdx++)
		{
			var esName = existingHostSections[esIdx];
			var esMac = uciOriginal.get("dhcp", esName, "mac");
			if(esMac != null && esMac != "")
			{
				macToSection[esMac.toLowerCase()] = esName;
			}
			var esMatch = esName.match(/^device_(\d+)$/);
			if(esMatch != null)
			{
				maxDeviceIndex = Math.max(maxDeviceIndex, parseInt(esMatch[1], 10));
			}
		}

		uci = uciOriginal.clone();
		uci.remove('dhcp', dhcpSection, 'ignore');
		uci.set('dhcp', dhcpSection, 'interface', 'lan');
		dhcpIds =  ['dhcp_start', ['dhcp_start','dhcp_end']];
		dhcpVisIds = ['dhcp_start', 'dhcp_end'];
		dhcpPkgs = ['dhcp','dhcp'];
		dhcpSections = [dhcpSection,dhcpSection];
		dhcpOptions = ['start', 'limit'];

		dhcpFunctions = [setVariableFromValue, setVariableFromCombined];
		limitParams =  [false, function(values){ return (parseInt(values[1]) - parseInt(values[0]) + 1); }];
		dhcpParams = [false, limitParams];

		setVariables(dhcpIds, dhcpVisIds, uci, dhcpPkgs, dhcpSections, dhcpOptions, dhcpFunctions, dhcpParams);

		// leasetime: the field is minutes, but the stored value may use any
		// dnsmasq suffix (h/m/s). Only rewrite when the DURATION actually
		// changed -- an untouched page must not rewrite '12h' as '720m'
		// (same value, different spelling), or a no-op save isn't a no-op
		// (caught live by vnet phase 35's uci-export invariance check).
		var newLeaseMin = parseInt(document.getElementById('dhcp_lease').value);
		var origLease = "" + uciOriginal.get('dhcp', dhcpSection, 'leasetime');
		var origLeaseMin = null;
		if(origLease.match(/h$/)) { origLeaseMin = parseFloat(origLease) * 60; }
		else if(origLease.match(/m$/)) { origLeaseMin = parseFloat(origLease); }
		else if(origLease.match(/s$/)) { origLeaseMin = parseFloat(origLease) / 60; }
		if(origLeaseMin == null || origLeaseMin != newLeaseMin)
		{
			uci.set('dhcp', dhcpSection, 'leasetime', newLeaseMin + "m");
		}

		// dnsmasq dhcp-option 3 = the "Router" (gateway) option -- lets this
		// LAN's DHCP clients be handed a different default gateway than the
		// router's own address, e.g. a separate upstream firewall on the same
		// subnet. dhcp_option is a general-purpose LIST in OpenWrt's schema
		// and users set other codes in it by hand (custom DNS = 6, NTP = 42,
		// WPAD = 252 -- the Gargoyle forum documents doing exactly this), so
		// this page only ever manages the one "3,..." entry: everything else
		// is read, kept, and written back untouched. (The previous version
		// treated the whole thing as a single scalar it owned outright --
		// every save wiped the user's other options, discussion #48 P1/P2.)
		var origDhcpOptions = uciOriginal.get('dhcp', dhcpSection, 'dhcp_option');
		origDhcpOptions = (origDhcpOptions == null || origDhcpOptions == '') ? [] : (Array.isArray(origDhcpOptions) ? origDhcpOptions : [origDhcpOptions]);
		var altGwEnabled = document.getElementById("dhcp_use_alt_gateway").checked;
		var altGwIp = document.getElementById('alt_gateway').value;
		// Only written when explicitly enabled and different from the
		// router's own IP (which is what clients get by default anyway).
		var altGwWanted = (altGwEnabled && altGwIp != defaultAltGateway);
		// Replace an existing "3,..." entry IN PLACE (keeping list order --
		// remove-then-append would rewrite an unchanged config in a new
		// order, so a no-op save wouldn't be a no-op) or drop it; append
		// only when there was none.
		var newDhcpOptions = [];
		var oi;
		for(oi = 0; oi < origDhcpOptions.length; oi++)
		{
			if( (("" + origDhcpOptions[oi]).split(","))[0] == '3' )
			{
				if(altGwWanted)
				{
					newDhcpOptions.push('3,' + altGwIp);
					altGwWanted = false;
				}
			}
			else
			{
				newDhcpOptions.push(origDhcpOptions[oi]);
			}
		}
		if(altGwWanted)
		{
			newDhcpOptions.push('3,' + altGwIp);
		}
		var dhcpOptionsChanged = (newDhcpOptions.length != origDhcpOptions.length);
		for(oi = 0; (!dhcpOptionsChanged) && oi < newDhcpOptions.length; oi++)
		{
			dhcpOptionsChanged = (newDhcpOptions[oi] != origDhcpOptions[oi]);
		}
		if(dhcpOptionsChanged)
		{
			if(newDhcpOptions.length == 0)
			{
				uci.remove('dhcp', dhcpSection, 'dhcp_option');
			}
			else
			{
				uci.createListOption('dhcp', dhcpSection, 'dhcp_option');
				uci.set('dhcp', dhcpSection, 'dhcp_option', newDhcpOptions);
			}
		}

		dhcpWillBeEnabled = true;
		if(document.getElementById("dhcp_enabled").checked )
		{
			uci.remove("dhcp", "lan", "ignore");
			uci.set("dhcp","lan","dhcpv6",document.getElementById("dhcpv6").value);
			uci.set("dhcp","lan","ra",document.getElementById("ra").value);
			uci.set("dhcp","lan","ra_slaac",document.getElementById("ra_slaac").value);
		}
		else
		{
			uci.set("dhcp", "lan", "ignore", "1");
			uci.set("dhcp","lan","dhcpv6","disabled");
			uci.set("dhcp","lan","ra","disabled");
			uci.set("dhcp","lan","ra_slaac","0");
			dhcpWillBeEnabled = false;
		}

		// Unified Devices table: one "config host" section per device.
		// A device may carry any of: fixed IP, IPv6 suffix/DUID, group.
		// MAC is required. Exactly one section per device => no duplicate
		// dhcp-host lines => dnsmasq cannot be crashed by this page.
		var devTable = document.getElementById('devices_table_container').firstChild;
		var devData = getTableDataArray(devTable, true, false);
		var matchedSections = {};
		for(var devIdx = 0; devIdx < devData.length; devIdx++)
		{
			var row = devData[devIdx];
			var rMac = row[1];
			if(rMac == "" || rMac == "-") { continue; }   // MAC required

			var existingMatch = macToSection[rMac.toLowerCase()];
			var cfgid;
			if(existingMatch != null)
			{
				// Reuse the existing section so the per-field diff below
				// only emits commands for fields this tab actually changed
				// -- untouched fields stay exactly as this tab's own
				// oldSettings already had them, so an edit another tab
				// already saved to a field THIS tab never touched survives.
				cfgid = existingMatch;
				matchedSections[cfgid] = true;
			}
			else
			{
				// Genuinely new device -- keep the existing device_N naming
				// convention, continuing from the highest index this tab
				// knows about (rather than raw table position) so it stays
				// stable even when earlier rows were reused, not recreated.
				maxDeviceIndex = maxDeviceIndex + 1;
				cfgid = "device_" + maxDeviceIndex;
				uci.set("dhcp", cfgid, "", "host");
				staticHostCommands.push("uci set dhcp." + cfgid + "=host");
			}

			var rName = row[0];
			if(rName != "" && rName != "-") { uci.set("dhcp", cfgid, "name", rName); } else { uci.remove("dhcp", cfgid, "name"); }

			uci.set("dhcp", cfgid, "mac", rMac);

			var rIp = row[2];
			if(rIp != "" && rIp != "-") { uci.set("dhcp", cfgid, "ip", rIp); } else { uci.remove("dhcp", cfgid, "ip"); }

			var rHostid = row[3];
			if(rHostid != "" && rHostid != "-")
			{
				var splitHostId = rHostid.split(':');
				if(splitHostId.length == 4)
				{
					splitHostId[3] = ('0000' + splitHostId[3]).slice(-4);
				}
				uci.set("dhcp", cfgid, "hostid", splitHostId.join(''));
			}
			else { uci.remove("dhcp", cfgid, "hostid"); }

			var rDuid = row[4];
			if(rDuid != "" && rDuid != "-") { uci.set("dhcp", cfgid, "duid", rDuid); } else { uci.remove("dhcp", cfgid, "duid"); }

			var rGroup = row[5];
			if(rGroup != "" && rGroup != "-") { uci.set("dhcp", cfgid, "group", rGroup); } else { uci.remove("dhcp", cfgid, "group"); }
		}

		// Any section this tab knew about that no row still maps to (by
		// MAC) was actually removed by the user in this tab -- delete only
		// those, not every section wholesale.
		for(var esIdx2 = 0; esIdx2 < existingHostSections.length; esIdx2++)
		{
			var esName2 = existingHostSections[esIdx2];
			if(matchedSections[esName2] == null)
			{
				uciOriginal.removeSection("dhcp", esName2);
				uci.removeSection("dhcp", esName2);
				staticHostCommands.push("uci del dhcp." + esName2);
			}
		}

		// We don't use /etc/ethers anymore
		createEtherCommands = [ "touch /etc/ethers", "rm /etc/ethers" ];
		var dnsmasqsec = uci.getAllSectionsOfType("dhcp","dnsmasq");
		if(dnsmasqsec.length > 0)
		{
			uci.set("dhcp",dnsmasqsec[0],"readethers","0");
		}

		createHostCommands = [ "touch /etc/hosts", "rm /etc/hosts" ];
		createHostCommands.push("echo \"127.0.0.1\tlocalhost localhost4\" >> /etc/hosts");
		createHostCommands.push("echo \"::1\tlocalhost localhost6\" >> /etc/hosts");

		var firewallCommands = [];
		var firewallDefaultSections = uci.getAllSectionsOfType("firewall", "defaults");
		var oldBlockMismatches = uciOriginal.get("firewall", firewallDefaultSections[0], "enforce_dhcp_assignments") == "1" ? true : false;
		var newBlockMismatches = document.getElementById("block_mismatches").checked;
		if(newBlockMismatches != oldBlockMismatches)
		{
			if(newBlockMismatches)
			{
				uci.set("firewall", firewallDefaultSections[0], "enforce_dhcp_assignments", "1");
				firewallCommands.push("uci set firewall.@defaults[0].enforce_dhcp_assignments=1");
			}
			else
			{
				uci.remove("firewall", firewallDefaultSections[0], "enforce_dhcp_assignments");
				firewallCommands.push("uci del firewall.@defaults[0].enforce_dhcp_assignments");
			}
			firewallCommands.push("uci commit");
		}

		//need to restart firewall here because for add/remove of static ips, we need to restart bandwidth monitor, as well as for firewall commands above if we have any
		var restartDhcpCommand = "\n/etc/init.d/dnsmasq restart ; \n/etc/init.d/odhcpd restart ; \nsh /usr/lib/gargoyle/restart_firewall.sh ; \n/usr/lib/gargoyle/manage_groups.sh\n" ;

		commands = staticHostCommands.join("\n") + "\n" + uci.getScriptCommands(uciOriginal) + "\n" + createEtherCommands.join("\n") + "\n" + createHostCommands.join("\n") + "\n" + firewallCommands.join("\n") + "\n" + restartDhcpCommand ;

		var param = getParameterDefinition("commands", commands) + "&" + getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

		var stateChangeFunction = function(req)
		{
			if(req.readyState == 4)
			{
				uciOriginal = uci.clone();
				dhcpEnabled = dhcpWillBeEnabled;
				dhcpWillBeEnabled = null;
				resetData();
				setControlsEnabled(true);
				//alert(req.responseText);
			}
		}
		runAjax("POST", "utility/run_commands.sh", param, stateChangeFunction);
	}
}

function createEditButton()
{
	var editButton = createInput("button");
	editButton.textContent = UI.Edit;
	editButton.className = "btn btn-default btn-edit";
	editButton.onclick = editDeviceModal;
	return editButton;
}

function resetData()
{
	dhcpEnabled = uciOriginal.get("dhcp", "lan", "ignore") == "1" ? false : true;

	// Build the single unified Devices table from every "config host" section,
	// regardless of section name (migrates old static_host_*/known_device_*).
	var devTableData = [];
	hostSections = uciOriginal.getAllSectionsOfType("dhcp","host");
	var secIndex=0;
	for(secIndex=0; secIndex < hostSections.length ; secIndex++)
	{
		var hostSection = hostSections[secIndex];
		var host = uciOriginal.get("dhcp",hostSection,"name");
		var mac = uciOriginal.get("dhcp",hostSection,"mac");
		if(mac == "") { continue; }
		var ipv4 = uciOriginal.get("dhcp",hostSection,"ip");
		var hostid = uciOriginal.get("dhcp",hostSection,"hostid");
		var ipv6 = "-";
		if(hostid != "")
		{
			var disp = ("00000000" + hostid).slice(-8).replace(/([0-9a-f]{4})([0-9a-f]{4})/i,"::$1:$2");
			ipv6 = validateIP6(disp) == 0 ? ip6_canonical(disp) : "-";
		}
		var duid = uciOriginal.get("dhcp",hostSection,"duid");
		duid = duid == "" ? "-" : duid;
		var group = uciOriginal.get("dhcp",hostSection,"group");
		group = group == "" ? "-" : group;

		//Name, MAC, IPv4, IPv6 suffix, DUID, Group, Edit btn
		devTableData.push([
			host  == "" ? "-" : host,
			mac,
			ipv4  == "" ? "-" : ipv4,
			ipv6,
			duid,
			group,
			createEditButton()
		]);
	}
	columnNames=[UI.HsNm, 'MAC', 'IPv4', dhcpS.Suff, 'DUID', dhcpS.GrpNm, ''];
	var devTable=createTable(columnNames, devTableData, "devices_table", true, false, removeDeviceCallback );
	var tableContainer = document.getElementById('devices_table_container');
	if(tableContainer.firstChild != null)
	{
		tableContainer.removeChild(tableContainer.firstChild);
	}
	tableContainer.appendChild(devTable);

	dhcpIds =  ['dhcp_start', 'dhcp_end', 'dhcp_lease'];
	dhcpPkgs = ['dhcp',['dhcp','dhcp'],'dhcp'];
	dhcpSections = [dhcpSection,[dhcpSection,dhcpSection],dhcpSection];
	dhcpOptions = ['start', ['start','limit'], 'leasetime'];

	// The router's own full IP -- the default/reset value for the alt
	// gateway field, and what "not actually overridden" looks like on save.
	// (Strip any CIDR suffix: OpenWrt 24.10+ allows ipaddr='a.b.c.d/nn'.)
	defaultAltGateway = ("" + uciOriginal.get("network", "lan", "ipaddr")).split("/")[0];
	enabledTest = function(value){return value != 1;};
	endCombineFunc= function(values) { return (parseInt(values[0])+parseInt(values[1])-1); };
	leaseModFunc = function(value)
	{
		var leaseMinValue;
		if(value.match(/.*h/))
		{
			leaseMinValue=value.substr(0,value.length-1)*60;
		}
		else if(value.match(/.*m/))
		{
			leaseMinValue=value.substr(0,value.length-1);
		}
		else if(value.match(/.*s/))
		{
			leaseMinValue=value.substr(0,value.length-1)/(60);
		}
		return leaseMinValue;
	};
	dhcpParams = [100, [endCombineFunc,150],[720,leaseModFunc]];
	dhcpFunctions = [loadValueFromVariable, loadValueFromMultipleVariables, loadValueFromModifiedVariable];

	loadVariables(uciOriginal, dhcpIds, dhcpPkgs, dhcpSections, dhcpOptions, dhcpParams, dhcpFunctions);

	// dhcp_option is a raw "<code>,<value>" dnsmasq passthrough LIST (users
	// legitimately keep other codes in it -- DNS=6, NTP=42, WPAD=252); option
	// 3 is the DHCP "Router" (gateway) option, and it's the only entry this
	// page manages. Handled by hand rather than through loadVariables: the
	// value may be a scalar (legacy) OR an array (correct OpenWrt list type),
	// and the old scalar-only load path crashed the whole page on an array
	// (discussion #48 P5: v.split is not a function).
	var loadedDhcpOptions = uciOriginal.get('dhcp', dhcpSection, 'dhcp_option');
	loadedDhcpOptions = (loadedDhcpOptions == null || loadedDhcpOptions == '') ? [] : (Array.isArray(loadedDhcpOptions) ? loadedDhcpOptions : [loadedDhcpOptions]);
	var loadedAltGwIp = '';
	var lgi;
	for(lgi = 0; lgi < loadedDhcpOptions.length && loadedAltGwIp == ''; lgi++)
	{
		var lgEntry = "" + loadedDhcpOptions[lgi];
		if( (lgEntry.split(","))[0] == '3' )
		{
			// value = everything after the first comma (a full dotted IP)
			loadedAltGwIp = lgEntry.substring(lgEntry.indexOf(",") + 1);
		}
	}
	document.getElementById("dhcp_use_alt_gateway").checked = (loadedAltGwIp != '');
	document.getElementById("alt_gateway").value = (loadedAltGwIp != '' ? loadedAltGwIp : defaultAltGateway);

	document.getElementById("dhcp_enabled").checked = dhcpEnabled;
	setEnabled(document.getElementById('dhcp_enabled').checked);
	enableAssociatedField(document.getElementById('dhcp_use_alt_gateway'), 'alt_gateway', defaultAltGateway);
	// House the niche alt-gateway controls behind the page's existing
	// Advanced-disclosure pattern; auto-expand only when one is configured.
	setGwAdvancedVisible(loadedAltGwIp != '');
	updateAltGwWarning();

	var firewallDefaultSections = uciOriginal.getAllSectionsOfType("firewall", "defaults");
	var blockMismatches = uciOriginal.get("firewall", firewallDefaultSections[0], "enforce_dhcp_assignments") == "1" ? true : false;
	document.getElementById("block_mismatches").checked = blockMismatches;

	dhcpv6 = uciOriginal.get("dhcp", "lan", "dhcpv6");
	document.getElementById("dhcpv6").value = dhcpv6 == "" ? "disabled" : dhcpv6;

	ra = uciOriginal.get("dhcp", "lan", "ra");
	document.getElementById("ra").value = ra == "" ? "disabled" : ra;

	ra_slaac = uciOriginal.get("dhcp", "lan", "ra_slaac");
	document.getElementById("ra_slaac").value = ra_slaac == "" ? "0" : ra_slaac;

	var ip6txt = "";
	for(var x = 0; x < currentLanIp6.length; x++)
	{
		if(ip6_scope(currentLanIp6[x])[0] == "Global")
		{
			ip6txt = ip6txt + (x == 0 ? "" : "\n") + ip6_mask(currentLanIp6[x], currentLanMask6[x]) + "/" + currentLanMask6[x];
		}
	}
	setChildText("ip6prefix", ip6txt);

	//setup connected-hosts dropdown
	resetDeviceMacList();
}

function removeDeviceCallback(table, row)
{
	resetDeviceMacList();
}

// Populate the "select from currently connected hosts" dropdown, excluding
// MACs that already have a device row.
function resetDeviceMacList()
{
	var devTable = document.getElementById("devices_table_container").firstChild;
	var devTableData = devTable == null ? [] : getTableDataArray(devTable, true, false);
	var usedMacs = [];
	var di;
	for(di = 0; di < devTableData.length; di++)
	{
		usedMacs[ (devTableData[di][1]).toUpperCase() ] = 1;
	}

	var hmVals = [ "none" ];
	var hmText = [ dhcpS.SelH ];
	var leaseIndex = 0;
	for(leaseIndex=0; leaseIndex < leaseData.length; leaseIndex++)
	{
		var lease = leaseData[leaseIndex];
		var mac = (lease[0]).toUpperCase();
		if( usedMacs[ mac ] == null )
		{
			// value = hostname,mac,currentIp  (currentIp pre-fills the Fixed IP field)
			hmVals.push( lease[2] + "," + mac + "," + lease[1] );
			hmText.push( (lease[2] == "" || lease[2] == "*" ? lease[1] : lease[2] ) + " (" + mac + ")" );
		}
	}
	setAllowableSelections("dev_from_connected", hmVals, hmText);

	var hmEnabled = hmText.length > 1 && document.getElementById('dhcp_enabled').checked ? true : false;
	setElementEnabled(document.getElementById("dev_from_connected"), hmEnabled, "none");
}

function setEnabled(enabled)
{
	var ids=['dhcp_start', 'dhcp_end', 'dhcp_use_alt_gateway', 'alt_gateway', 'dhcp_lease', 'block_mismatches', 'dhcpv6', 'ra', 'add_device_button'];
	var altGatewayChecked = document.getElementById('dhcp_use_alt_gateway').checked;
	var idIndex;
	for (idIndex in ids)
	{
		var element = document.getElementById(ids[idIndex]);
		// alt_gateway is only ever enabled when the page itself is enabled
		// AND its own checkbox is checked -- everything else just follows
		// the page-wide enabled state.
		setElementEnabled(element, (element.id == 'alt_gateway' ? altGatewayChecked && enabled : enabled), (element.type == 'text' ? element.value : ''));
	}

	var devTable = document.getElementById('devices_table_container').firstChild;
	setRowClasses(devTable, enabled);

	resetDeviceMacList();
}

function validateDHCPHostName(hostname)
{
	if(hostname == '')
	{
		// Hostname is optional
		return 0;
	}
	else if(hostname.match(/^[a-zA-Z0-9-]+$/) == null)
	{
		// No special symbols in hostnames
		return 1;
	}
	return 0;
}

function proofreadDHCPHostName(input)
{
	proofreadText(input, validateDHCPHostName, 0);
}

function proofreadAll()
{
	dhcpIds = ['dhcp_start', 'dhcp_end', 'dhcp_lease'];
	labelIds= ['dhcp_start_label', 'dhcp_end_label', 'dhcp_lease_label'];
	functions = [validateNumeric, validateNumeric, validateNumeric];
	returnCodes = [0,0,0];
	visibilityIds= dhcpIds;
	errors = proofreadFields(dhcpIds, labelIds, functions, returnCodes, visibilityIds);
	// alt_gateway is a full IP address (any subnet size -- the old
	// last-octet-only field hardcoded a /24, discussion #48 P3), validated
	// only when its checkbox is actually enabled.
	if(document.getElementById("dhcp_use_alt_gateway").checked)
	{
		errors = errors.concat( proofreadFields(['alt_gateway'], ['alt_gateway_label'], [validateIP], [0], ['alt_gateway']) );
	}

	//test that dhcp range is within subnet
	if(errors.length == 0 && document.getElementById("dhcp_enabled").checked)
	{
		var dhcpSection = getDhcpSection(uciOriginal);
		var mask = uciOriginal.get("network", "lan", "netmask");
		var ip = uciOriginal.get("network", "lan", "ipaddr");
		var start = parseInt(document.getElementById("dhcp_start").value);
		var end = parseInt(document.getElementById("dhcp_end").value );
		var lease = parseInt(document.getElementById("dhcp_lease").value );
		if(!rangeInSubnet(mask, ip, start, end))
		{
			errors.push(dhcpS.dsubErr);
		}

		if(lease < 1)
		{
			errors.push(dhcpS.leaseErr);
		}

		var ipEnd = parseInt( (ip.split("."))[3] );
		if(ipEnd >= start && ipEnd <= end)
		{
			errors.push(dhcpS.dipErr);
		}

		if(document.getElementById("dhcp_use_alt_gateway").checked)
		{
			// Full-IP validation, correct for any subnet size: the gateway
			// must be inside the LAN subnet, not its network/broadcast
			// address, and not inside the DHCP pool (start/limit are offsets
			// from the subnet's network address, per OpenWrt's dhcp schema).
			var ipToInt = function(a)
			{
				var p = ("" + a).split(".");
				return ( (parseInt(p[0]) << 24) | (parseInt(p[1]) << 16) | (parseInt(p[2]) << 8) | parseInt(p[3]) ) >>> 0;
			};
			var gwInt = ipToInt(document.getElementById("alt_gateway").value);
			var maskInt = ipToInt(mask);
			var netInt = (ipToInt(ip.split("/")[0]) & maskInt) >>> 0;
			var bcastInt = (netInt | (~maskInt >>> 0)) >>> 0;
			if( ((gwInt & maskInt) >>> 0) != netInt || gwInt == netInt || gwInt == bcastInt )
			{
				errors.push(dhcpS.rangeGWErr);
			}
			if(gwInt >= (netInt + start) && gwInt <= (netInt + end))
			{
				errors.push(dhcpS.leaseGWErr);
			}
		}
	}

	return errors;
}

// ---- Unified Devices ----

function setDeviceAdvancedVisible(visible)
{
	var c = document.getElementById("dev_advanced_container");
	var t = document.getElementById("dev_advanced_toggle");
	if(c) { c.style.display = visible ? "" : "none"; }
	if(t) { t.textContent = visible ? (dhcpS.HideAdv || "Hide advanced (IPv6 reservation)") : (dhcpS.ShowAdv || "Show advanced (IPv6 reservation)"); }
}

function toggleDeviceAdvanced()
{
	var c = document.getElementById("dev_advanced_container");
	if(!c) { return; }
	setDeviceAdvancedVisible(c.style.display == "none");
}

// Advanced disclosure for the alternative-gateway controls (discussion #48
// option D): 99% of users never need this, and enabling it silently routes
// clients' internet traffic around this router (see updateAltGwWarning), so
// it lives behind the same Show/Hide-advanced pattern the Devices modal uses.
// All DOM lookups are null-guarded: the logic-test harness's minimal DOM
// doesn't carry these presentation-only elements.
function setGwAdvancedVisible(visible)
{
	var c = document.getElementById("gw_advanced_container");
	var t = document.getElementById("gw_advanced_toggle");
	if(c) { c.style.display = visible ? "" : "none"; }
	if(t) { t.textContent = visible ? (dhcpS.HideAdvGw || "Hide advanced (alternative gateway)") : (dhcpS.ShowAdvGw || "Show advanced (alternative gateway)"); }
}

function toggleGwAdvanced()
{
	var c = document.getElementById("gw_advanced_container");
	if(!c) { return; }
	setGwAdvancedVisible(c.style.display == "none");
}

// Plain-language warning (discussion #48 P4), shown whenever the checkbox is
// ticked: devices using the alternative gateway bypass this router entirely
// for internet traffic, so monitoring/quotas/restrictions/QoS stop applying.
function updateAltGwWarning()
{
	var w = document.getElementById("alt_gateway_warning");
	if(!w) { return; }
	var cb = document.getElementById("dhcp_use_alt_gateway");
	w.style.display = (cb != null && cb.checked) ? "" : "none";
}

function populateGroupDatalist()
{
	var datalist = document.getElementById("dev_group_list");
	if(!datalist) { return; }
	while(datalist.firstChild) { datalist.removeChild(datalist.firstChild); }

	var seen = {};
	var gi;
	for(gi = 0; gi < knownDeviceGroups.length; gi++)
	{
		seen[knownDeviceGroups[gi]] = 1;
	}
	var devTable = document.getElementById("devices_table_container").firstChild;
	if(devTable)
	{
		var devData = getTableDataArray(devTable, true, false);
		var ri;
		for(ri = 0; ri < devData.length; ri++)
		{
			var grp = devData[ri][5];
			if(grp && grp != "-") { seen[grp] = 1; }
		}
	}
	var grpName;
	for(grpName in seen)
	{
		var opt = document.createElement("option");
		opt.value = grpName;
		datalist.appendChild(opt);
	}
}

function proofreadDevice(excludeRow)
{
	var validateOptionalIp = function(val)
	{
		if(val == "" || val == "-") { return 0; }
		return validateIP(val);
	};
	var proofreadIP6Suffix = function(val)
	{
		if(val.length == 0 || val == "-") { return 0; }   // optional
		if(!val.match(/^::([0-9a-f]{0,4}:)?[0-9a-f]{0,4}/)) { return 1; }
		return 0;
	};
	var proofreadDUID = function(val)
	{
		if(val == "" || val == "-") { return 0; }          // optional
		if(!val.match(/^[0-9a-f]{0,130}$/i)) { return 1; }
		return 0;
	};

	var addIds    = ['dev_name', 'dev_mac', 'dev_ip', 'dev_hostid', 'dev_duid'];
	var labelIds  = ['dev_name_label', 'dev_mac_label', 'dev_ip_label', 'dev_hostid_label', 'dev_duid_label'];
	var functions = [validateDHCPHostName, validateMac, validateOptionalIp, proofreadIP6Suffix, proofreadDUID];
	var returnCodes = [0,0,0,0,0];
	var errors = proofreadFields(addIds, labelIds, functions, returnCodes, addIds, document);

	// Group is optional, but if set it must be a safe name: letters, digits,
	// hyphen, underscore only. Spaces / special chars break the GROUP:<name>
	// references used by firewall/quota/restriction rules and the nftables set.
	var devGroupEl = document.getElementById("dev_group");
	var validateGroupName = function(val)
	{
		if(val == "" || val == "-") { return 0; }            // optional
		return val.match(/^[a-zA-Z0-9_-]+$/) == null ? 1 : 0;
	};
	if(devGroupEl)
	{
		proofreadText(devGroupEl, validateGroupName, 0);
		if(validateGroupName(devGroupEl.value) != 0)
		{
			errors.push(dhcpS.grpErr);
		}
	}

	var nameVal = document.getElementById('dev_name').value;
	var macVal  = document.getElementById('dev_mac').value;
	var ipVal   = document.getElementById('dev_ip').value;
	var hidVal  = document.getElementById('dev_hostid').value;
	var duidVal = document.getElementById('dev_duid').value;

	if(errors.length == 0)
	{
		var devTable = document.getElementById('devices_table_container').firstChild;
		var currentData = getTableDataArray(devTable, true, false);
		var rowDataIndex = 0;
		for (rowDataIndex=0; rowDataIndex < currentData.length ; rowDataIndex++)
		{
			if(devTable.rows[rowDataIndex+1] == excludeRow) { continue; }
			var rowData = currentData[rowDataIndex];
			if(nameVal != '' && nameVal != '-' && rowData[0] == nameVal)
			{
				errors.push(dhcpS.dHErr);
			}
			if(rowData[1].toUpperCase() == macVal.toUpperCase())
			{
				errors.push(dhcpS.dMErr);
			}
			if(ipVal != '' && ipVal != '-' && rowData[2] == ipVal)
			{
				errors.push(dhcpS.dIPErr);
			}
			if(hidVal != '' && hidVal != '-' && rowData[3] != '-' && rowData[3] == hidVal)
			{
				errors.push(dhcpS.dHIDErr);
			}
			if(duidVal != '' && duidVal != '-' && rowData[4] != '-' && rowData[4] == duidVal)
			{
				errors.push(dhcpS.dDUIDErr);
			}
		}
	}

	// IPv6 suffix requires a DUID
	if(errors.length == 0)
	{
		if((hidVal != "" && hidVal != "-") && (duidVal == "" || duidVal == "-"))
		{
			errors.push(dhcpS.NoDUID);
		}
	}

	// Fixed IP, when set, must be inside the LAN subnet and not the router IP
	if(errors.length == 0 && ipVal != "" && ipVal != "-")
	{
		var mask = uciOriginal.get("network", "lan", "netmask");
		var ip = uciOriginal.get("network", "lan", "ipaddr");
		var testEnd = parseInt( (ipVal.split("."))[3] );
		if(!rangeInSubnet(mask, ip, testEnd, testEnd))
		{
			errors.push(dhcpS.subErr);
		}
		if(ip == ipVal)
		{
			errors.push(dhcpS.ipErr);
		}
	}

	return errors;
}

function addDevice()
{
	var errors = proofreadDevice(null);
	if(errors.length > 0)
	{
		alert(errors.join("\n") + "\n\n" + dhcpS.AErr);
	}
	else
	{
		var dName  = document.getElementById('dev_name').value;
		var dMac   = document.getElementById('dev_mac').value;
		var dIp    = document.getElementById('dev_ip').value;
		var dHid   = document.getElementById('dev_hostid').value;
		var dDuid  = document.getElementById('dev_duid').value;
		var dGroup = document.getElementById('dev_group').value;

		var values = [
			dName  == "" ? "-" : dName,
			dMac,
			dIp    == "" ? "-" : dIp,
			dHid   == "" ? "-" : dHid,
			dDuid  == "" ? "-" : dDuid,
			dGroup == "" ? "-" : dGroup,
			createEditButton()
		];
		var devTable = document.getElementById('devices_table_container').firstChild;
		addTableRow(devTable, values, true, false, removeDeviceCallback);
		resetDeviceMacList();
		closeModalWindow('device_modal');
	}
}

function editDevice(editRow)
{
	var errors = proofreadDevice(editRow);
	if(errors.length > 0)
	{
		alert(errors.join("\n") + "\n" + dhcpS.upErr);
	}
	else
	{
		var dName  = document.getElementById('dev_name').value;
		var dMac   = document.getElementById('dev_mac').value;
		var dIp    = document.getElementById('dev_ip').value;
		var dHid   = document.getElementById('dev_hostid').value;
		var dDuid  = document.getElementById('dev_duid').value;
		var dGroup = document.getElementById('dev_group').value;

		editRow.childNodes[0].firstChild.data = dName  == "" ? "-" : dName;
		editRow.childNodes[1].firstChild.data = dMac;
		editRow.childNodes[2].firstChild.data = dIp    == "" ? "-" : dIp;
		editRow.childNodes[3].firstChild.data = dHid   == "" ? "-" : dHid;
		editRow.childNodes[4].firstChild.data = dDuid  == "" ? "-" : dDuid;
		editRow.childNodes[5].firstChild.data = dGroup == "" ? "-" : dGroup;

		closeModalWindow('device_modal');
		resetDeviceMacList();
	}
}

function addDeviceModal()
{
	populateGroupDatalist();
	var modalButtons = [
		{"title" : UI.Add, "classes" : "btn btn-primary", "function" : addDevice},
		"defaultDismiss"
	];

	var name = "";
	var mac  = "";
	var ip   = "";
	var selectedVal = getSelectedValue("dev_from_connected");
	if(selectedVal != "none")
	{
		var parts = selectedVal.split(/,/);
		name = parts[0];
		mac  = parts[1];
		ip   = (parts[2] == null || parts[2] == "*") ? "" : parts[2];
		setSelectedValue("dev_from_connected", "none");
	}

	var modalElements = [
		{"id" : "dev_name",   "value" : name == "*" ? "" : name},
		{"id" : "dev_mac",    "value" : mac},
		{"id" : "dev_ip",     "value" : ip},
		{"id" : "dev_hostid", "value" : ""},
		{"id" : "dev_duid",   "value" : ""},
		{"id" : "dev_group",  "value" : ""}
	];
	modalPrepare('device_modal', dhcpS.AdDev, modalElements, modalButtons);
	setDeviceAdvancedVisible(false);
	openModalWindow('device_modal');
}

function editDeviceModal()
{
	var editRow = this.parentNode.parentNode;
	populateGroupDatalist();
	var modalButtons = [
		{"title" : UI.CApplyChanges, "classes" : "btn btn-primary", "function" : function() { editDevice(editRow); }},
		"defaultDiscard"
	];

	var dName  = editRow.childNodes[0].firstChild.data;
	var dMac   = editRow.childNodes[1].firstChild.data;
	var dIp    = editRow.childNodes[2].firstChild.data;
	var dHid   = editRow.childNodes[3].firstChild.data;
	var dDuid  = editRow.childNodes[4].firstChild.data;
	var dGroup = editRow.childNodes[5].firstChild.data;

	var modalElements = [
		{"id" : "dev_name",   "value" : dName  == "-" ? "" : dName},
		{"id" : "dev_mac",    "value" : dMac},
		{"id" : "dev_ip",     "value" : dIp    == "-" ? "" : dIp},
		{"id" : "dev_hostid", "value" : dHid   == "-" ? "" : dHid},
		{"id" : "dev_duid",   "value" : dDuid  == "-" ? "" : dDuid},
		{"id" : "dev_group",  "value" : dGroup == "-" ? "" : dGroup}
	];
	modalPrepare('device_modal', dhcpS.EDev, modalElements, modalButtons);
	// auto-expand the advanced section only if this device already uses IPv6 fields
	var hasAdvanced = (dHid != "-" && dHid != "") || (dDuid != "-" && dDuid != "");
	setDeviceAdvancedVisible(hasAdvanced);
	openModalWindow('device_modal');
}
