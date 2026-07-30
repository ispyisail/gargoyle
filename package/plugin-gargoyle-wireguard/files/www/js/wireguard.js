var wgStr = new Object();

function resetData()
{
	uci = uciOriginal.clone();

	serverEnabled = uciOriginal.get("wireguard_gargoyle","server","enabled");
	clientEnabled = uciOriginal.get("wireguard_gargoyle","client","enabled");
	serverEnabled = serverEnabled == "true" || serverEnabled == "1" ? true : false;
	clientEnabled = clientEnabled == "true" || clientEnabled == "1" ? true : false;

	var mode = "disabled";
	mode = serverEnabled ? "server" : mode;
	mode = clientEnabled ? "client" : mode;
	setSelectedValue("wireguard_config",mode);

	//Server
	getServerVarWithDefault = function(variable, defaultDef) {
		var def = uciOriginal.get("wireguard_gargoyle", "server", variable)
		def = def == "" ? defaultDef : def
		return def
	}

	document.getElementById("wireguard_server_ip").value = getServerVarWithDefault("ip","10.64.0.1");
	document.getElementById("wireguard_server_mask").value = getServerVarWithDefault("submask","255.255.255.0");
	document.getElementById("wireguard_server_ip6").value = getServerVarWithDefault("ip6","");
	document.getElementById("wireguard_server_mask6").value = getServerVarWithDefault("submask6","");
	document.getElementById("wireguard_server_port").value = getServerVarWithDefault("port","51820");
	setSelectedValue("wireguard_server_client_to_client",getServerVarWithDefault("c2c","true"));
	setSelectedValue("wireguard_server_subnet_access",getServerVarWithDefault("lan_access","true"));
	setSelectedValue("wireguard_server_redirect_gateway",getServerVarWithDefault("all_client_traffic","true"));
	document.getElementById("wireguard_server_privkey").value = getServerVarWithDefault("private_key","");
	document.getElementById("wireguard_server_pubkey").value = getServerVarWithDefault("public_key","");
	if(wgStatus != "Interface wg0 not found")
	{
		var wgStatusJSON = JSON.parse(wgStatus);
		var wgStatusStr = "";
		var txtCol = "#880000";
		if(wgStatusJSON["up"])
		{
			wgStatusStr = "Online, ";
			txtCol = "#008800";
		}
		else
		{
			wgStatusStr = "Offline, ";
		}
		if(wgStatusJSON["ipv4-address"] !== undefined)
		{
			wgStatusStr = wgStatusStr + "IP: " + wgStatusJSON["ipv4-address"][0]["address"];
		}
		else
		{
			wgStatusStr = wgStatusStr + "IP: -";
		}
		setChildText("wireguard_config_status", wgStatusStr, txtCol, true, null, document)
	}

	var acTableData = []
	var allowedClients = uciOriginal.getAllSectionsOfType("wireguard_gargoyle", "allowed_client")
	var aci;
	for(aci=0; aci < allowedClients.length; aci++)
	{
		var rowData = []
		var id          = allowedClients[aci]
		var name        = uciOriginal.get("wireguard_gargoyle", id, "name")
		var ip          = uciOriginal.get("wireguard_gargoyle", id, "ip")
		var subnetIp   = uciOriginal.get("wireguard_gargoyle", id, "subnet_ip")
		var subnetMask = uciOriginal.get("wireguard_gargoyle", id, "subnet_mask")
		var enabled     = uciOriginal.get("wireguard_gargoyle", id, "enabled")
		var subnet = subnetIp != "" && subnetMask != "" ? subnetIp + "/" + subnetMask : ""
		var pubkey     = uciOriginal.get("wireguard_gargoyle", id, "public_key")
		var haveprivkey     = uciOriginal.get("wireguard_gargoyle", id, "private_key") == "" ? false : true;

		var ipElementContainer = document.createElement("span")
		var naContainer = document.createElement("span")
		var ipContainer = document.createElement("span")
		ipContainer.appendChild( document.createTextNode(ip) )
		ipContainer.appendChild( document.createElement("br") )
		ipContainer.appendChild( document.createTextNode(subnet) )
		ipElementContainer.appendChild(ipContainer)
		ipElementContainer.id = id

		rowData.push(name + "\n ")
		rowData.push(ipElementContainer)
		rowData.push(pubkey)
		
		var controls = createAllowedClientControls(haveprivkey)
		while(controls.length > 0)
		{
			rowData.push( controls.shift() )
		}

		enabled = enabled != "false" && enabled != "0" ? true : false;
		rowData[3].checked = enabled
		
		acTableData.push(rowData)
	}

	var acTable = createTable([ wgStr.ClntN, wgStr.IntIP, wgStr.wgPubKey, UI.Enabled, wgStr.ClntCfg, ""], acTableData, "wireguard_allowed_client_table", true, false, removeAcCallback)
	var tableContainer = document.getElementById("wireguard_allowed_client_table_container");
	while(tableContainer.firstChild != null)
	{
		tableContainer.removeChild(tableContainer.firstChild);
	}
	tableContainer.appendChild(acTable);

	//Client
	getClientVarWithDefault = function(variable, defaultDef) {
		var def = uciOriginal.get("wireguard_gargoyle", "client", variable)
		def = def == "" ? defaultDef : def
		return def
	}
	document.getElementById("wireguard_client_ip").value = getClientVarWithDefault("ip","10.64.0.2");
	document.getElementById("wireguard_client_server_pubkey").value = getClientVarWithDefault("server_public_key","");
	document.getElementById("wireguard_client_server_host").value = getClientVarWithDefault("server_host","");
	document.getElementById("wireguard_client_server_port").value = getClientVarWithDefault("server_port","51820");
	document.getElementById("wireguard_client_privkey").value = getClientVarWithDefault("private_key","");
	document.getElementById("wireguard_client_pubkey").value = getClientVarWithDefault("public_key","");
	document.getElementById("wireguard_client_allowed_ips").value = getClientVarWithDefault("allowed_ips","0.0.0.0/0");
	setSelectedValue("wireguard_client_allow_nonwg_traffic",getClientVarWithDefault("allow_nonwg_traffic","true"));
	if(uciOriginal.get("wireguard_gargoyle","client","enabled") == "1")
	{
		document.getElementById("wireguard_client_config_manual").checked = true;
	}

	setWireguardVisibility()
}

// onComplete (optional) fires once the backend has actually committed the
// save -- not before. The wizards below need this: they show a real,
// actionable Download button right after calling this, and the local uci
// this function edits is updated synchronously, but the PERSIST is a
// separate async request. Rendering that button as soon as this function
// merely returns (as opposed to once its own request finishes) let it
// overlap a second run_commands.sh call the button's own click makes, both
// serialized behind the same server-side lock -- confirmed live to
// occasionally produce a 0-byte config download when they landed close
// together.
//
// deferReload (optional) skips scheduling the automatic reload below.
// Normally that reload is exactly what a plain Save button wants (show
// "please wait", reload 5s later, done) -- but it fires on a FIXED TIMER
// regardless of what the user is doing, and the wizards below keep the
// modal open afterward with real actionable buttons (Download, Add
// Another) of their own. Confirmed live: even after fixing the button's
// own click-blocking overlay, a user who takes more than ~5s to click
// Download gets the whole modal wiped out from under them by this timer
// mid-interaction, with no way to recover the download. Wizard callers
// pass true here and take over the reload themselves -- once the user
// actually finishes (clicks Done), not on an arbitrary clock.
//
// Every other caller passes neither argument and is unaffected.
function saveChanges(onComplete, deferReload)
{
	var errorList = proofreadAll();
	if(errorList.length > 0)
	{
		errorString = errorList.join("\n") + "\n\n"+UI.ErrChanges;
		alert(errorString);
	}
	else
	{
		setControlsEnabled(false, true);
		
		var wgConfig = getSelectedValue("wireguard_config")

		configureFirewall = function(enabled,isServer,client2client,wgPort)
		{
			if(enabled)
			{
				uci.set("firewall", "wg_zone", "",        "zone")
				uci.set("firewall", "wg_zone", "name",    "wg")
				uci.set("firewall", "wg_zone", "device", "wg0")
				uci.set("firewall", "wg_zone", "input",   "ACCEPT")
				uci.set("firewall", "wg_zone", "output",  "ACCEPT")
				if(client2client)
				{
					uci.set("firewall", "wg_zone", "forward", "ACCEPT")
				}
				else
				{
					uci.set("firewall", "wg_zone", "forward", "REJECT")
				}
				uci.set("firewall", "wg_zone", "mtu_fix", "1")
				uci.set("firewall", "wg_zone", "masq",    "1")

				uci.set("firewall", "wg_lan_forwarding", "",     "forwarding")
				uci.set("firewall", "wg_lan_forwarding", "src",  "lan")
				uci.set("firewall", "wg_lan_forwarding", "dest", "wg")

				uci.set("firewall", "lan_wg_forwarding", "",     "forwarding")
				uci.set("firewall", "lan_wg_forwarding", "src",  "wg")
				uci.set("firewall", "lan_wg_forwarding", "dest", "lan")	

				if(isServer)
				{
					uci.set("firewall", "ra_wireguard", "",            "remote_accept")
					uci.set("firewall", "ra_wireguard", "zone",        "wan")
					uci.set("firewall", "ra_wireguard", "local_port",  wgPort)
					uci.set("firewall", "ra_wireguard", "remote_port", wgPort)
					uci.set("firewall", "ra_wireguard", "proto",       "udp")

					uci.set("firewall", "wg_wan_forwarding", "",     "forwarding")
					uci.set("firewall", "wg_wan_forwarding", "src",  "wg")
					uci.set("firewall", "wg_wan_forwarding", "dest", "wan")

					if(getSelectedValue("wireguard_server_subnet_access") != "true" )
					{
						uci.removeSection("firewall", "lan_wg_forwarding")
					}
				}
				else
				{
					uci.removeSection("firewall", "wg_wan_forwarding")
				}
			}
			else
			{
				uci.removeSection("firewall", "wg_zone")
				uci.removeSection("firewall", "lan_wg_forwarding")
				uci.removeSection("firewall", "wg_lan_forwarding")
				uci.removeSection("firewall", "wg_wan_forwarding")
				uci.removeSection("firewall", "ra_wireguard")
			}
		}

		configureAC = function(clientId,pubkey,ipArr,endpointHost,endpointPort)
		{
			uci.set("network", clientId, "",        "wireguard_wg0")
			uci.set("network", clientId, "public_key", pubkey)
			uci.createListOption("network", clientId, "allowed_ips", true)
			uci.set("network", clientId, "allowed_ips", ipArr)
			uci.set("network", clientId, "route_allowed_ips", "1")
			if(endpointHost != null && endpointPort != null)
			{
				uci.set("network", clientId, "endpoint_host", endpointHost)
				uci.set("network", clientId, "endpoint_port", endpointPort)
			}
		}

		// wgAddrs may be a single CIDR string (client mode) or an array of CIDRs
		// (server mode, dual-stack: [v4, v6]). network.wg0.addresses is a list, so
		// dual-stack is just more entries.
		configureNetwork = function(enabled,wgPrivKey,wgAddrs,wgPort)
		{
			if(enabled)
			{
				uci.set("network", "wg0", "",        "interface")
				uci.set("network", "wg0", "proto",    "wireguard")
				uci.set("network", "wg0", "private_key", wgPrivKey)
				uci.set("network", "wg0", "listen_port",   wgPort)
				uci.createListOption("network", "wg0", "addresses", true)
				uci.set("network", "wg0", "addresses",   (typeof wgAddrs == "string" ? [wgAddrs] : wgAddrs))
			}
			else
			{
				uci.removeSection("network", "wg0")
			}
		}

		if(wgConfig == "disabled")
		{
			configureFirewall(false)
			configureNetwork(false)
			uci.removeAllSectionsOfType("network","wireguard_wg0");
			uci.remove("gargoyle", "status", "wireguard_connections")
			uci.set("wireguard_gargoyle", "server", "enabled", "0")
			uci.set("wireguard_gargoyle", "client", "enabled", "0")
		}
		if(wgConfig == "server")
		{
			var prefix   = "wireguard_server_"
			var wgPort  = document.getElementById(prefix + "port").value
			var client_to_client = document.getElementById(prefix + "client_to_client").value == "true" ? true : false;
			configureFirewall(true,true,client_to_client,wgPort)

			uci.set("gargoyle", "status", "wireguard_connections", "501")

			uci.set("wireguard_gargoyle", "server", "enabled", "1")
			uci.set("wireguard_gargoyle", "client", "enabled", "0")

			var privkey = document.getElementById(prefix + "privkey").value;
			uci.set("wireguard_gargoyle", "server", "private_key", privkey)
			uci.set("wireguard_gargoyle", "server", "public_key", document.getElementById(prefix + "pubkey").value)
			var ip = document.getElementById(prefix + "ip").value;
			uci.set("wireguard_gargoyle", "server", "ip", ip)
			var submask = document.getElementById(prefix + "mask").value;
			var subcidr = parseCidr(submask);
			uci.set("wireguard_gargoyle", "server", "submask", submask)
			uci.set("wireguard_gargoyle", "server", "port", wgPort)
			uci.set("wireguard_gargoyle", "server", "c2c", getSelectedValue(prefix + "client_to_client"))
			uci.set("wireguard_gargoyle", "server", "lan_access", getSelectedValue(prefix + "subnet_access"))
			uci.set("wireguard_gargoyle", "server", "all_client_traffic", getSelectedValue(prefix + "redirect_gateway"))

			// Optional IPv6 (dual-stack). submask6 is a prefix length (e.g. 64).
			// Empty = IPv4-only, leaving the address list byte-identical to before.
			var ip6 = document.getElementById(prefix + "ip6").value;
			var submask6 = document.getElementById(prefix + "mask6").value;
			uci.set("wireguard_gargoyle", "server", "ip6", ip6)
			uci.set("wireguard_gargoyle", "server", "submask6", submask6)

			var wgAddrs = [ip + "/" + subcidr];
			if(ip6 != "" && submask6 != "") { wgAddrs.push(ip6 + "/" + submask6); }
			configureNetwork(true,privkey,wgAddrs,wgPort);

			uci.removeAllSectionsOfType("network","wireguard_wg0");
			wgACs = uci.getAllSectionsOfType("wireguard_gargoyle","allowed_client");
			var wgACIdx = 0;
			for(wgACIdx = 0; wgACIdx < wgACs.length; wgACIdx ++)
			{
				if(uci.get("wireguard_gargoyle",wgACs[wgACIdx],"enabled") == "1")
				{
					var clientId = uci.get("wireguard_gargoyle",wgACs[wgACIdx],"id");
					var pubkey = uci.get("wireguard_gargoyle",wgACs[wgACIdx],"public_key");
					var ip = uci.get("wireguard_gargoyle",wgACs[wgACIdx],"ip");
					var ipArr = [];
					ipArr.push(ip + "/32");
					// WireGuard's AllowedIPs also gates which source addresses this
					// peer is allowed to send from, so the peer's own derived v6
					// tunnel address (the same one downloadAc() puts in its
					// Interface Address line) must be allowed here too, or that
					// peer's IPv6 traffic is silently dropped even though the
					// downloaded config gives it that address to use.
					if(ip6 != "" && submask6 != "")
					{
						var acIp6 = wgDeriveClientIp6(ip6, submask6, ip);
						if(acIp6 != "")
						{
							ipArr.push(acIp6 + "/128");
						}
					}
					var subnetip = uci.get("wireguard_gargoyle",wgACs[wgACIdx],"subnet_ip");
					var subnetmask = uci.get("wireguard_gargoyle",wgACs[wgACIdx],"subnet_mask");
					if(subnetip != "" && subnetmask != "")
					{
						subnetmask = parseCidr(subnetmask);
						ipArr.push(subnetip + "/" + subnetmask);
					}
					// Optional IPv6 subnet behind this peer (site-to-site v6).
					// subnet_mask6 is a prefix length (e.g. 64).
					var subnetip6 = uci.get("wireguard_gargoyle",wgACs[wgACIdx],"subnet_ip6");
					var subnetmask6 = uci.get("wireguard_gargoyle",wgACs[wgACIdx],"subnet_mask6");
					if(subnetip6 != "" && subnetmask6 != "")
					{
						ipArr.push(subnetip6 + "/" + subnetmask6);
					}
					configureAC(clientId,pubkey,ipArr,null,null);
				}
			}
		}
		if(wgConfig == "client")
		{
			var prefix   = "wireguard_client_"
			configureFirewall(true,false,true)
			var privkey = document.getElementById(prefix + "privkey").value;
			var ip = document.getElementById(prefix + "ip").value;
			configureNetwork(true,privkey,ip + "/32","51820")

			uci.remove("gargoyle", "status", "wireguard_connections")

			uci.set("wireguard_gargoyle", "server", "enabled", "0")
			uci.set("wireguard_gargoyle", "client", "enabled", "1")

			uci.set("wireguard_gargoyle", "client", "private_key", privkey)
			uci.set("wireguard_gargoyle", "client", "public_key", document.getElementById(prefix + "pubkey").value)
			uci.set("wireguard_gargoyle", "client", "ip", ip)
			var allowed_ips = document.getElementById(prefix + "allowed_ips").value;
			uci.set("wireguard_gargoyle", "client", "allowed_ips", allowed_ips)
			uci.set("wireguard_gargoyle", "client", "allow_nonwg_traffic", document.getElementById(prefix + "allow_nonwg_traffic").value)
			var endpoint_host = document.getElementById(prefix + "server_host").value;
			var endpoint_port = document.getElementById(prefix + "server_port").value;
			uci.set("wireguard_gargoyle", "client", "server_host", endpoint_host)
			uci.set("wireguard_gargoyle", "client", "server_port", endpoint_port)
			var server_pubkey = document.getElementById(prefix + "server_pubkey").value;
			uci.set("wireguard_gargoyle", "client", "server_public_key", server_pubkey)
			uci.removeAllSectionsOfType("network","wireguard_wg0");
			configureAC("wgserver",server_pubkey,allowed_ips.split(','),endpoint_host,endpoint_port);
		}


		var commands = uci.getScriptCommands(uciOriginal) + "\n" ;
		// If we are doing anything to network config that isn't just adding clients, we need to restart
		if(commands.match(/(network\.wg0\.|firewall\.)/) != null)
		{
			commands = commands + "\n/usr/lib/gargoyle/restart_network.sh ;\n"
			commands = commands + "\n/etc/wireguard.firewall update_enabled ;\n"
		}
		else
		{
			commands = commands + "\nifup wg0;\n"
		}

		var param = getParameterDefinition("commands", commands) + "&" + getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));
		
		var stateChangeFunction = function(req)
		{
			if(req.readyState == 4)
			{
				if(typeof onComplete == "function")
				{
					onComplete();
				}
				if(!deferReload)
				{
					setTimeout(function () {
						//Give wireguard 5 seconds to come up.
						//It is much quicker than this, but it helps the status flow
						//through to the user in a more expected way if we wait
						window.location=window.location;
					}, 5000);
				}
			}
		}
		runAjax("POST", "utility/run_commands.sh", param, stateChangeFunction);
	}
}

function setWireguardVisibility()
{
	mode = getSelectedValue("wireguard_config");
	if(mode == "disabled")
	{
		document.getElementById("wireguard_server_fieldset").style.display = "none";
		document.getElementById("wireguard_allowed_client_fieldset").style.display = "none";
		document.getElementById("wireguard_client_fieldset").style.display = "none";
	}
	else
	{
		document.getElementById("wireguard_server_fieldset").style.display = mode == "server" ? "block" : "none";
		document.getElementById("wireguard_allowed_client_fieldset").style.display = mode == "server" ? "block" : "none";
		document.getElementById("wireguard_client_fieldset").style.display = mode == "client" ? "block" : "none";
	}
	document.getElementById("wireguard_config_status_container").style.display = mode == "disabled" ? "none" : "block";

	setClientVisibility()
}

function togglePass(name)
{
	password_field = document.getElementById(name);
	if(password_field.type == 'password')
	{
		password_field.type = 'text';
	}
	else
	{
		password_field.type = 'password';
	}
}

function toggleTunnelNameWarning()
{
	alertDiv = byId('warn_tunname_toolong');
	name = byId('wireguard_allowed_client_name').value;
	if(name.length > 12)
	{
		// Limit is 15 (wg- + 12 chars)
		alertDiv.style.display = 'block';
	}
	else
	{
		alertDiv.style.display = 'none';
	}
}

function generateKeyPair(section)
{
	commands = "mkdir -p /tmp/wireguard\ncd /tmp/wireguard\nwg genkey | tee ./privatekey | wg pubkey > ./publickey\ncat /tmp/wireguard/*";

	var param = getParameterDefinition("commands", commands)  + "&" + getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

	var stateChangeFunction = function(req)
	{
		if(req.readyState == 4)
		{
			var lines = req.responseText;
			lines = lines.split("\n");
			if(lines.length >= 2)
			{
				if(section == "server")
				{
					document.getElementById("wireguard_server_privkey").value = lines[0];
					document.getElementById("wireguard_server_pubkey").value = lines[1];
				}
				if(section == "allowed_client")
				{
					document.getElementById("wireguard_allowed_client_privkey").value = lines[0];
					document.getElementById("wireguard_allowed_client_pubkey").value = lines[1];
				}
				if(section == "client")
				{
					document.getElementById("wireguard_client_privkey").value = lines[0];
					document.getElementById("wireguard_client_pubkey").value = lines[1];
				}
			}
			setControlsEnabled(true);
		}
	}
	runAjax("POST", "utility/run_commands.sh", param, stateChangeFunction);
}

function createAllowedClientControls(haveDownload)
{

	var enabledCheck = createInput("checkbox")
	enabledCheck.onclick = toggleAcEnabled;
	var downloadButton = haveDownload ? createButton(wgStr.Dload, "btn-download", downloadAc, false) : createButton(wgStr.Dload, "btn-download disabled", function(){ return; }, true ) ;

	var editButton = createButton(UI.Edit, "btn-edit", editWgClientModal, false)

	return [enabledCheck, downloadButton, editButton]
}

function createButton(text, cssClass, actionFunction, disabled)
{
	var button = createInput("button")
	button.textContent = text
	button.className = "btn btn-default " + cssClass
	button.onclick = actionFunction
	button.disabled = disabled
	return button;
}

function toggleAcEnabled()
{
	var toggleRow=this.parentNode.parentNode;
	var toggleId = toggleRow.childNodes[1].firstChild.id;

	uci.set("wireguard_gargoyle", toggleId, "enabled", (this.checked? "1" : "0"));
}

function downloadAc()
{
	var downloadRow=this.parentNode.parentNode;
	var downloadId = downloadRow.childNodes[1].firstChild.id;

	// Config generation lives in the shared wg_client_config.js (loaded via this
	// page's -j list) so it stays in sync with the QR-code plugin's client
	// configs instead of drifting the way the two used to.
	var built = wgBuildClientConfig(uci, downloadId, currentLanIp, currentLanMask);
	var confLines = wgRenderClientConfig(built.iface, built.peer).split("\n");

	commands = [];
	commands.push("touch /tmp/wg.ac.tmp.conf");
	commands.push("rm /tmp/wg.ac.tmp.conf");
	commands.push("touch /tmp/wg.ac.tmp.conf");
	var lineIdx;
	for(lineIdx = 0; lineIdx < confLines.length; lineIdx++)
	{
		commands.push("echo '" + confLines[lineIdx] + "' >> /tmp/wg.ac.tmp.conf");
	}

	commands = commands.join("\n");

	var param = getParameterDefinition("commands", commands)  + "&" + getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

	var stateChangeFunction = function(req)
	{
		if(req.readyState == 4)
		{
			// Download
			setControlsEnabled(true);
			window.location="/utility/wireguard_download_credentials.sh?id=" + downloadId
		}
	}
	runAjax("POST", "utility/run_commands.sh", param, stateChangeFunction);
}

function removeAcCallback(table, row)
{
	var id = row.childNodes[1].firstChild.id;
	uci.removeSection("wireguard_gargoyle", id);
}

function addWgClientModal()
{
	modalButtons = [
		{"title" : UI.Add, "classes" : "btn btn-primary", "function" : addAc},
		"defaultDismiss"
	];

	modalElements = [];

	setAcDocumentFromUci(new UCIContainer(), "dummy", false, document.getElementById("wireguard_server_ip").value )
	modalPrepare('wireguard_allowed_client_modal', wgStr.ClntCfg, modalElements, modalButtons);
	openModalWindow('wireguard_allowed_client_modal');
}

function editWgClientModal()
{
	editRow=this.parentNode.parentNode;
	var editId = editRow.childNodes[1].firstChild.id;
	var serverInternalIp = document.getElementById("wireguard_server_ip").value;
	var serverInternalMask = document.getElementById("wireguard_server_mask").value;

	modalButtons = [
		{"title" : UI.CApplyChanges, "classes" : "btn btn-primary", "function" : function(){editAc(editRow,editId,serverInternalIp,serverInternalMask);}},
		"defaultDiscard"
	];

	modalElements = [];

	setAcDocumentFromUci(uci, editId, false, serverInternalIp);

	modalPrepare('wireguard_allowed_client_modal', wgStr.EditWCS, modalElements, modalButtons);
	openModalWindow('wireguard_allowed_client_modal');
}

function setAcDocumentFromUci(srcUci, id, dupeCn, serverInternalIp)
{
	var name = srcUci.get("wireguard_gargoyle", id, "name")
	
	if( srcUci.get("wireguard_gargoyle", id, "remote") == "" )
	{
		var allIdList = getDefinedAcIds(false)
		var allIdHash = getDefinedAcIds(true)
		var clientCount = allIdList.length +1
		name = wgStr.Clnt + clientCount
		id = "client" + clientCount
		while(allIdHash[id] == 1)
		{
			clientCount++
			name = wgStr.Clnt + clientCount
			id = "client" + clientCount
		}
		document.getElementById("wireguard_allowed_client_default_id").value = id
	}
	else
	{
		document.getElementById("wireguard_allowed_client_initial_id").value = id
	}

	document.getElementById("wireguard_allowed_client_name").value = name
	

	var ip = srcUci.get("wireguard_gargoyle", id, "ip")
	if(ip == "")
	{
		ip = getUnusedAcIp(serverInternalIp)

	}
	document.getElementById("wireguard_allowed_client_ip").value = ip
	
	setRemoteNames(srcUci.get("wireguard_gargoyle", id, "remote"))

	var subnetIp   = srcUci.get("wireguard_gargoyle", id, "subnet_ip")
	var subnetMask = srcUci.get("wireguard_gargoyle", id, "subnet_mask")

	setSelectedValue("wireguard_allowed_client_have_subnet", (subnetIp != "" && subnetMask != "" ? "true" : "false"), document)
	// Prefill an obscure-but-valid RFC1918 subnet as a format example. The old
	// default (192.168.2.0/24) collided with the LAN Gargoyle auto-relocates
	// to behind a 192.168.1.1 upstream (the common double-NAT case), so a user
	// who enabled "route the subnet below" without editing it routed their own
	// LAN into the tunnel and locked themselves out (forum thread 18405). An
	// obscure third octet won't match a real LAN, the WireGuard server subnet
	// (10.64.0.0/24 default), or GL.iNet's 192.168.8.0/24 -- and validateAc()
	// now also rejects a routed subnet that overlaps either, as a backstop.
	subnetIp   = subnetIp   == "" ? "192.168.177.1" : subnetIp;
	subnetMask = subnetMask == "" ? "255.255.255.0" : subnetMask;
	document.getElementById("wireguard_allowed_client_subnet_ip").value = subnetIp;
	document.getElementById("wireguard_allowed_client_subnet_mask").value = subnetMask;

	// Optional IPv6 subnet behind the client (blank = none, even when a v4 subnet is set)
	var subnetIp6   = srcUci.get("wireguard_gargoyle", id, "subnet_ip6")
	var subnetMask6 = srcUci.get("wireguard_gargoyle", id, "subnet_mask6")
	document.getElementById("wireguard_allowed_client_subnet_ip6").value = subnetIp6;
	document.getElementById("wireguard_allowed_client_subnet_mask6").value = subnetMask6;

	var pubkey = srcUci.get("wireguard_gargoyle", id, "public_key")
	var privkey = srcUci.get("wireguard_gargoyle", id, "private_key")
	setSelectedValue("wireguard_allowed_client_have_privkey", (privkey != "" ? "true" : "false"), document)
	document.getElementById("wireguard_allowed_client_pubkey").value = pubkey;
	document.getElementById("wireguard_allowed_client_privkey").value = privkey;

	setAllowedClientVisibility();
}

function getDefinedAcIps(retHash)
{
	var ips = []
	var allowedClients = getDefinedAcIds(false)
	var aci;
	for(aci=0; aci < allowedClients.length; aci++)
	{
		var ip = uci.get("wireguard_gargoyle", allowedClients[aci], "ip")
		if(ip != "")
		{
			if(retHash)
			{
				ips[ip] = 1;
			}
			else
			{
				ips.push(ip)
			}
		}
	}
	return ips;
}

function getDefinedAcIds(retHash)
{
	var ids = []
	var allowedClients = uci.getAllSectionsOfType("wireguard_gargoyle", "allowed_client")
	var aci;
	for(aci=0; aci < allowedClients.length; aci++)
	{
		var id = allowedClients[aci]
		var enabled = uci.get("wireguard_gargoyle", id, "enabled")
		if(enabled != "0" && enabled != "false")
		{
			if(retHash)
			{
				ids[id] = 1;
			}
			else
			{
				ids.push(id)
			}
		}
	}
	return ids;
}

function getUnusedAcIp(serverInternalIp)
{
	var ipParts = serverInternalIp.split(/\./)
	var fourthIpPart = ipParts.pop()
	var thirdIpPart  = ipParts.pop()
	var secondIpPart = ipParts.pop()
	var firstIpPart  = ipParts.pop()

	fourthIpPart = parseInt(fourthIpPart);
	thirdIpPart  = parseInt(thirdIpPart);
	secondIpPart = parseInt(secondIpPart);
	fourthIpPart++;

	
	var candidateDefaultIp = firstIpPart + "." + secondIpPart + "." + thirdIpPart + "." + fourthIpPart

	var definedIps = getDefinedAcIps(true);
	definedIps[serverInternalIp] = 1
	while( (fourthIpPart < 255 || thirdIpPart < 255 || secondIpPart < 255) && definedIps[candidateDefaultIp] == 1)
	{
		fourthIpPart++
		if(fourthIpPart == 255)
		{
			fourthIpPart = 1
			thirdIpPart++
		}
		if(thirdIpPart == 255)
		{
			thirdIpPart = 0
			secondIpPart++
		}
		if(secondIpPart != 255)
		{	
			candidateDefaultIp = firstIpPart + "." + secondIpPart + "." + thirdIpPart + "." + fourthIpPart
		}
	}
	return candidateDefaultIp
}

function addAc()
{
	var errors = validateAc(document.getElementById("wireguard_server_ip").value , document.getElementById("wireguard_server_mask").value );
	if(errors.length > 0)
	{
		alert(errors.join("\n") + "\n"+wgStr.AddCErr);
	}
	else
	{
		var name       = document.getElementById("wireguard_allowed_client_name").value
		var ip         = document.getElementById("wireguard_allowed_client_ip").value
		var subnetIp   = ""
		var subnetMask = ""
		if( getSelectedValue("wireguard_allowed_client_have_subnet", document) == "true")
		{
			subnetIp   = document.getElementById("wireguard_allowed_client_subnet_ip").value
			subnetMask = document.getElementById("wireguard_allowed_client_subnet_mask").value
		}
		var subnet = subnetIp != "" && subnetMask != "" ? subnetIp + "/" + subnetMask : ""
		var pubkey       = document.getElementById("wireguard_allowed_client_pubkey").value
	
		var id = name.replace(/[\t\r\n -]+/g, "_").toLowerCase().replace(/[^a-z0-9_]/g, "");
		var idCount = 1;
		var testId = id
		while(uci.get("wireguard_gargoyle", testId) != "")
		{
			testId = id + "_" + idCount
			idCount++
		}
		id = testId

		setAcUciFromDocument(id)
		uci.set("wireguard_gargoyle", id, "enabled", "1")

		var ipElementContainer = document.createElement("span")
		var ipContainer = document.createElement("span")
		ipContainer.appendChild( document.createTextNode(ip) )
		ipContainer.appendChild( document.createElement("br") )
		ipContainer.appendChild( document.createTextNode(subnet) )
		ipElementContainer.appendChild(ipContainer)
		ipElementContainer.id = id

		var acTable = document.getElementById("wireguard_allowed_client_table");

		var rowData = [ name, ipElementContainer, pubkey ]
		var controls = createAllowedClientControls(false)
		while(controls.length > 0)
		{
			rowData.push( controls.shift() )
		}
		rowData[3].checked = true
		addTableRow(acTable, rowData, true, false, removeAcCallback);
	
		setAcDocumentFromUci(new UCIContainer(), "dummy", false, document.getElementById("wireguard_server_ip").value )
		closeModalWindow('wireguard_allowed_client_modal');
	}
}

function setRemoteNames(selectedRemote)
{
	var selectId = "wireguard_allowed_client_remote";
	selectedRemote = selectedRemote == null ? "" : selectedRemote;

	var names = []
	var values = []
	
	var definedDdns = uciOriginal.getAllSectionsOfType("ddns_gargoyle", "service")
	var ddi
	var selectedFound = false
	for(ddi=0; ddi < definedDdns.length; ddi++)
	{
		var enabled = uciOriginal.get("ddns_gargoyle", definedDdns[ddi], "enabled")
		var domain  = uciOriginal.get("ddns_gargoyle", definedDdns[ddi], "domain");
		var testDomain = uciOriginal.get("ddns_gargoyle", definedDdns[ddi], "test_domain");
		domain = testDomain == "" ? domain : testDomain;
		if( (enabled != "0" && enabled != "false") && domain != "")
		{
			if(values.indexOf(domain) == -1)
			{
				names.push(wgStr.DDNS+": " + domain)
				values.push(domain)
				selectedFound = selectedRemote == domain ? true : selectedFound
			}
		}
	}
	selectedFound = (selectedRemote == currentWanIp) || selectedFound
	if(currentWanIp)
	{
		names.push("WAN IP: " + currentWanIp)
		values.push(currentWanIp)
	}
	names.push(wgStr.OthIPD)
	values.push("custom")
	
	setAllowableSelections(selectId, values, names, document)
	var chosen = selectedRemote == "" ? values[0] : selectedRemote
	chosen = (!selectedFound) && selectedRemote != "" ? "custom" : selectedRemote
	setSelectedValue(selectId, chosen, document)
	if(chosen == "custom")
	{
		document.getElementById("wireguard_allowed_client_remote_custom").value = selectedRemote
	}
}

function setAllowedClientVisibility()
{
	var selectedVis = document.getElementById("wireguard_allowed_client_remote_container").style.display == "none" ? "none" : "block"
	document.getElementById("wireguard_allowed_client_remote_custom_container").style.display  = getSelectedValue("wireguard_allowed_client_remote", document) == "custom" ? selectedVis : "none";

	var selectedVis = document.getElementById("wireguard_allowed_client_have_subnet_container").style.display == "none" ? "none" : "block"
	document.getElementById("wireguard_allowed_client_subnet_ip_container").style.display = getSelectedValue("wireguard_allowed_client_have_subnet", document) == "true" ? selectedVis : "none";
	document.getElementById("wireguard_allowed_client_subnet_mask_container").style.display = getSelectedValue("wireguard_allowed_client_have_subnet", document) == "true" ? selectedVis : "none";
	document.getElementById("wireguard_allowed_client_subnet_ip6_container").style.display = getSelectedValue("wireguard_allowed_client_have_subnet", document) == "true" ? selectedVis : "none";
	document.getElementById("wireguard_allowed_client_subnet_mask6_container").style.display = getSelectedValue("wireguard_allowed_client_have_subnet", document) == "true" ? selectedVis : "none";

	var selectedVis = document.getElementById("wireguard_allowed_client_have_privkey_container").style.display == "none" ? "none" : "block"
	document.getElementById("wireguard_allowed_client_privkey_container").style.display = getSelectedValue("wireguard_allowed_client_have_privkey", document) == "true" ? selectedVis : "none";
	document.getElementById("generate_allowed_client_keys_button").disabled = getSelectedValue("wireguard_allowed_client_have_privkey", document) == "true" ? false : true;
	if(getSelectedValue("wireguard_allowed_client_have_privkey", document) == "true")
	{
		document.getElementById("wireguard_allowed_client_pubkey").setAttribute("readonly", true);
	}
	else
	{
		document.getElementById("wireguard_allowed_client_pubkey").removeAttribute("readonly");
	}
}

function validateAc(internalServerIp, internalServerMask)
{
	var validateHaveText = function(txt) {  return txt.length > 0 ? 0 : 1 }

	var prefix = "wireguard_allowed_client_"
	var inputIds = [ prefix + "name", prefix + "pubkey", prefix + "privkey", prefix + "ip", prefix + "remote_custom", prefix + "subnet_ip", prefix + "subnet_mask" ]
	var labelIds = [ prefix + "name_label", prefix + "pubkey_label", prefix + "privkey", prefix + "ip_label", prefix + "remote_label",  prefix + "have_subnet_label", prefix + "have_subnet_label" ]
	var functions = [ validateHaveText, validateHaveText, validateHaveText, validateIP, validateHaveText, validateIP, validateNetMask  ];
	var validReturnCodes = [0,0,0,0,0,0,0]
	var visibilityIds = [  prefix + "name_container", prefix + "pubkey_container", prefix + "privkey_container", prefix + "ip_container", prefix + "remote_custom_container", prefix + "subnet_ip_container", prefix + "subnet_mask_container" ]

	var errors = proofreadFields(inputIds, labelIds, functions, validReturnCodes, visibilityIds, document );
	if(errors.length == 0 && document.getElementById(prefix + "ip_container").style.display != "none")
	{
		var testIp  = parseIp(document.getElementById(prefix + "ip").value)
		var wgIp   = parseIp(internalServerIp)
		var wgMask = parseMask(internalServerMask)
		if( ( testIp & wgMask ) != ( wgIp & wgMask ) )
		{
			errors.push(wgStr.ClntIntIP+" " + document.getElementById(prefix + "ip").value + " "+wgStr.OSubErr)
		}
	}
	if(errors.length == 0)
	{
		var name = document.getElementById(prefix + "name").value;
		var id = name.replace(/[\t\r\n ]+/g, "_").toLowerCase().replace(/[^a-z0-9_-]/g, "");
		if(id == "lan" || id == "wan" || id == "tun0" || id == "wg0" || id == "wgserver")
		{
			errors.push(wgStr.ClntNotAllow);
		}
	}
	if(errors.length == 0 && document.getElementById(prefix + "subnet_ip_container").style.display != "none")
	{
		var subnetIpEl   = document.getElementById(prefix + "subnet_ip")
		var subnetMaskEl = document.getElementById(prefix + "subnet_mask")
		subnetIpEl.value = applyMask(subnetIpEl.value, subnetMaskEl.value)

		// Backstop for the lockout in forum thread 18405: a routed "subnet
		// behind client" that overlaps the router's own LAN or the WireGuard
		// server subnet sends that traffic into the tunnel instead of locally.
		// Two subnets overlap when their network addresses match under the
		// less-specific (shorter) of the two masks. Refuse the save rather
		// than let the admin route their own management network away.
		var subNet  = parseIp(subnetIpEl.value)
		var subMask = parseMask(subnetMaskEl.value)
		var subnetsOverlap = function(net1, mask1, net2, mask2)
		{
			var common = mask1 & mask2
			return (net1 & common) == (net2 & common)
		}
		if( typeof currentLanIp != "undefined" && typeof currentLanMask != "undefined" )
		{
			var lanMask = parseMask(currentLanMask)
			if( subnetsOverlap(subNet, subMask, parseIp(currentLanIp) & lanMask, lanMask) )
			{
				errors.push(wgStr.SubOvLan)
			}
		}
		var wgSrvMask = parseMask(internalServerMask)
		if( subnetsOverlap(subNet, subMask, parseIp(internalServerIp) & wgSrvMask, wgSrvMask) )
		{
			errors.push(wgStr.SubOvWg)
		}
	}
	if(errors.length == 0 && document.getElementById(prefix + "subnet_ip6_container").style.display != "none")
	{
		var subnetIp6   = document.getElementById(prefix + "subnet_ip6").value
		var subnetMask6 = document.getElementById(prefix + "subnet_mask6").value
		if(subnetIp6 != "" || subnetMask6 != "")
		{
			if(validateIP6(subnetIp6) != 0)
			{
				errors.push(wgStr.wgErrACIP6)
			}
			var m6 = subnetMask6 * 1
			if(subnetMask6 == "" || isNaN(m6) || m6 < 1 || m6 > 128)
			{
				errors.push(wgStr.wgErrMask6)
			}
		}
	}

	return errors;
}

function parseMask(mask)
{
	if(mask.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/))
	{
		return parseIp(mask)
	}
	else
	{
		return -1<<(32-mask)
	}
}

function applyMask(ip, mask)
{
	return ipToStr( parseIp(ip) & parseMask(mask) )
}

function setAcUciFromDocument(id)
{
	var name = document.getElementById("wireguard_allowed_client_name").value;
	
	var ipContainer = document.getElementById("wireguard_allowed_client_ip_container")
	var ip = document.getElementById("wireguard_allowed_client_ip").value
	ip = ipContainer.style.display == "none" ? "" : ip
	
	var remote = getSelectedValue("wireguard_allowed_client_remote", document)
	remote = remote == "custom" ? document.getElementById("wireguard_allowed_client_remote_custom").value : remote
	
	var haveSubnet = getSelectedValue("wireguard_allowed_client_have_subnet", document) == "true" ? true : false
	haveSubnet     = ipContainer.style.display == "none" ? false : haveSubnet
	var subnetIp   = document.getElementById("wireguard_allowed_client_subnet_ip").value
	var subnetMask = document.getElementById("wireguard_allowed_client_subnet_mask").value

	var havePrivkey = getSelectedValue("wireguard_allowed_client_have_privkey", document) == "true" ? true : false
	var privkey = document.getElementById("wireguard_allowed_client_privkey").value
	var pubkey = document.getElementById("wireguard_allowed_client_pubkey").value

	var pkg = "wireguard_gargoyle"
	uci.set(pkg, id, "", "allowed_client")
	uci.set(pkg, id, "id", id)
	uci.set(pkg, id, "name", name)
	if(ip != "")
	{
		uci.set(pkg, id, "ip", ip)
	}
	else
	{
		uci.remove(pkg, id, "ip")
	}
	uci.set(pkg, id, "remote", remote)
	var subnetIp6   = document.getElementById("wireguard_allowed_client_subnet_ip6").value
	var subnetMask6 = document.getElementById("wireguard_allowed_client_subnet_mask6").value
	if(haveSubnet)
	{
		uci.set(pkg, id, "subnet_ip",   subnetIp)
		uci.set(pkg, id, "subnet_mask", subnetMask)
		if(subnetIp6 != "" && subnetMask6 != "")
		{
			uci.set(pkg, id, "subnet_ip6",   subnetIp6)
			uci.set(pkg, id, "subnet_mask6", subnetMask6)
		}
		else
		{
			uci.remove(pkg, id, "subnet_ip6")
			uci.remove(pkg, id, "subnet_mask6")
		}
	}
	else
	{
		uci.remove(pkg, id, "subnet_ip")
		uci.remove(pkg, id, "subnet_mask")
		uci.remove(pkg, id, "subnet_ip6")
		uci.remove(pkg, id, "subnet_mask6")
	}
	uci.set(pkg, id, "public_key", pubkey)
	if(havePrivkey)
	{
		uci.set(pkg, id, "private_key",   privkey)
	}
	else
	{
		uci.remove(pkg, id, "private_key")
	}
}

function editAc(editRow,editId,serverInternalIp,serverInternalMask)
{
	var errors = validateAc(serverInternalIp, serverInternalMask);
	if(errors.length > 0)
	{
		alert(errors.join("\n") + "\n"+wgStr.UpCErr);
	}
	else
	{
		var name       = document.getElementById("wireguard_allowed_client_name").value
		var ip         = document.getElementById("wireguard_allowed_client_ip").value
		var subnetIp   = ""
		var subnetMask = ""
		if(getSelectedValue("wireguard_allowed_client_have_subnet", document) == "true")
		{
			subnetIp   = document.getElementById("wireguard_allowed_client_subnet_ip").value
			subnetMask = document.getElementById("wireguard_allowed_client_subnet_mask").value
		}
		var subnet = subnetIp != "" && subnetMask != "" ? subnetIp + "/" + subnetMask : ""
		var pubkey   = document.getElementById("wireguard_allowed_client_pubkey").value

		setAcUciFromDocument(editId)
					
		while( editRow.childNodes[0].firstChild != null)
		{
			editRow.childNodes[0].removeChild( editRow.childNodes[0].firstChild )
		}
		editRow.childNodes[0].appendChild(document.createTextNode(name))

		var ipElementContainer = document.createElement("span")
		var ipContainer = document.createElement("span")
		ipContainer.appendChild( document.createTextNode(ip) )
		ipContainer.appendChild( document.createElement("br") )
		ipContainer.appendChild( document.createTextNode(subnet) )
		ipElementContainer.appendChild(ipContainer)
		ipElementContainer.id = editId

		while( editRow.childNodes[1].firstChild != null)
		{
			editRow.childNodes[1].removeChild( editRow.childNodes[1].firstChild )
		}						
		editRow.childNodes[1].appendChild( ipElementContainer )

		while( editRow.childNodes[2].firstChild != null)
		{
			editRow.childNodes[2].removeChild( editRow.childNodes[2].firstChild )
		}
		editRow.childNodes[2].appendChild(document.createTextNode(pubkey))
		closeModalWindow('wireguard_allowed_client_modal');
	}
}

function setClientVisibility()
{
	var upCheckEl  = document.getElementById("wireguard_client_config_upload");
	var manCheckEl = document.getElementById("wireguard_client_config_manual");

	if( (!upCheckEl.checked) && (!manCheckEl.checked) )
	{
		upCheckEl.checked = true;
	}

	if(upCheckEl.checked)
	{
		document.getElementById("wireguard_client_manual_config").style.display = "none";
		document.getElementById("wireguard_client_upload_config").style.display = "block";
	}
	else
	{
		document.getElementById("wireguard_client_manual_config").style.display = "block";
		document.getElementById("wireguard_client_upload_config").style.display = "none";
	}
}

function doUpload()
{
	if(document.getElementById('wireguard_client_config_file').value.length == 0)
	{
		alert(wgStr.SelErr);
	}
	else
	{
		document.getElementById('wireguard_client_hash').value = document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, "");
		document.getElementById('wireguard_client_form').submit();
		setControlsEnabled(false, true, wgStr.Uping);
	}
}

function uploaded()
{
	document.getElementById("wireguard_client_config_file").value = "";
	setControlsEnabled(true, false);
	uploadFrame = document.getElementById("client_add_target");
	uploadFrameDoc = (uploadFrame.contentDocument) ? uploadFrame.contentDocument : uploadFrame.contentWindow.document;

	cfgcontents = uploadFrameDoc.getElementById("cfgcontents").innerHTML;
	parseCfg(cfgcontents.split("\n"));
}

function parseCfg(cfgdata)
{
	// Look for sections first
	interfaceStart = cfgdata.indexOf("[Interface]");
	interfaceStop = interfaceStart;
	peerStart = cfgdata.indexOf("[Peer]");
	peerStop = peerStart;

	if(interfaceStart > -1 && peerStart > -1)
	{
		// Find section ends
		var cfgdataidx = 0;		
		for(cfgdataidx = interfaceStart+1; cfgdataidx < cfgdata.length; cfgdataidx++)
		{
			if(cfgdata[cfgdataidx] == "" || cfgdata[cfgdataidx].match(/^\[/) != null)
			{
				interfaceStop = cfgdataidx;
				break;
			}
			if(cfgdataidx == cfgdata.length -1)
			{
				interfaceStop = cfgdataidx;
			}
		}
		for(cfgdataidx = peerStart+1; cfgdataidx < cfgdata.length; cfgdataidx++)
		{
			if(cfgdata[cfgdataidx] == "" || cfgdata[cfgdataidx].match(/^\[/) != null)
			{
				peerStop = cfgdataidx;
				break;
			}
			if(cfgdataidx == cfgdata.length -1)
			{
				peerStop = cfgdataidx;
			}
		}
		// Do interface
		var cfgdataidx = 0;
		for(cfgdataidx = interfaceStart+1; cfgdataidx <= interfaceStop; cfgdataidx++)
		{
			var lineParts = cfgdata[cfgdataidx].split("=");
			if(lineParts.length > 1)
			{
				var key = lineParts[0].trim();
				var val = lineParts.slice(1).join('=').trim();

				if(key == "Address")
				{
					var subLineParts = val.split("/");
					document.getElementById("wireguard_client_ip").value = subLineParts[0];
				}
				else if(key == "PrivateKey")
				{
					document.getElementById("wireguard_client_privkey").value = val;
					setPubkeyFromPrivkey(val,"wireguard_client_pubkey");
				}
			}
		}
		// Do peer (server)
		for(cfgdataidx = peerStart+1; cfgdataidx <= peerStop; cfgdataidx++)
		{
			var lineParts = cfgdata[cfgdataidx].split("=");
			if(lineParts.length > 1)
			{
				var key = lineParts[0].trim();
				var val = lineParts.slice(1).join('=').trim();

				if(key == "AllowedIPs")
				{
					document.getElementById("wireguard_client_allowed_ips").value = val;
				}
				else if(key == "Endpoint")
				{
					var subLineParts = val.split(":");
					if(subLineParts.length > 1)
					{
						document.getElementById("wireguard_client_server_host").value = subLineParts[0];
						document.getElementById("wireguard_client_server_port").value = subLineParts[1];
					}
				}
				else if(key == "PublicKey")
				{
					document.getElementById("wireguard_client_server_pubkey").value = val;
				}
			}
		}
		wireguard_client_config_manual.checked = true;
		wireguard_client_config_upload.checked = false;
		setClientVisibility();
	}
	else
	{
		alert(wgStr.BadCfg);
	}
}

function setPubkeyFromPrivkey(privkey, section)
{
	commands = "echo \"" + privkey + "\" | wg pubkey";

	var param = getParameterDefinition("commands", commands)  + "&" + getParameterDefinition("hash", document.cookie.replace(/^.*hash=/,"").replace(/[\t ;]+.*$/, ""));

	var stateChangeFunction = function(req)
	{
		if(req.readyState == 4)
		{
			var lines = req.responseText;
			lines = lines.split("\n");
			if(lines.length >= 1)
			{
				document.getElementById(section).value = lines[0];
			}
			setControlsEnabled(true);
		}
	}
	runAjax("POST", "utility/run_commands.sh", param, stateChangeFunction);
}

function proofreadAll()
{
	var validateHaveText = function(txt) {  return txt.length > 0 ? 0 : 1 }
	errors = [];
	if(getSelectedValue("wireguard_config") == "server")
	{
		var prefix = "wireguard_server_"
		var inputIds = [ prefix + "privkey", prefix + "pubkey", prefix + "ip", prefix + "mask", prefix + "port" ]
		var labelIds = [ prefix + "privkey_label", prefix + "pubkey_label", prefix + "ip_label", prefix + "mask_label", prefix + "port_label" ]
		var functions = [ validateHaveText, validateHaveText, validateIP, validateNetMask, validatePort ];
		var validReturnCodes = [0,0,0,0,0]

		var errors = proofreadFields(inputIds, labelIds, functions, validReturnCodes, inputIds, document );
	
		if(errors.length == 0)
		{
			// Additional checks
			// port clash? ip clash?
		}

		// Optional IPv6: if either field is set, both must be valid (v6 address
		// + prefix length 1-128). Leaving both blank keeps the server IPv4-only.
		var ip6 = document.getElementById(prefix + "ip6").value;
		var mask6 = document.getElementById(prefix + "mask6").value;
		if(ip6 != "" || mask6 != "")
		{
			if(validateIP6(ip6) != 0) { errors.push(wgStr.wgErrIP6); }
			var m6 = mask6 * 1;
			if(mask6 == "" || isNaN(m6) || m6 < 1 || m6 > 128) { errors.push(wgStr.wgErrMask6); }
		}
	}
	if(getSelectedValue("wireguard_config") == "client")
	{
		if(document.getElementById("wireguard_client_manual_config").style.display != "none" )
		{
			var prefix = "wireguard_client_"
			var inputIds = [ prefix + "server_pubkey", prefix + "server_host", prefix + "server_port", prefix + "privkey", prefix + "pubkey", prefix + "ip" ]
			var labelIds = [ prefix + "server_pubkey_label", prefix + "server_host_label", prefix + "server_port_label", prefix + "privkey_label", prefix + "pubkey_label", prefix + "ip_label" ]
			var functions = [ validateHaveText, validateHaveText, validatePort, validateHaveText, validateHaveText, validateIP ];
			var validReturnCodes = [0,0,0,0,0,0]

			var errors = proofreadFields(inputIds, labelIds, functions, validReturnCodes, inputIds, document );
	
			if(errors.length == 0)
			{
				// Additional checks
				// port clash? ip clash?
			}
		}
		else
		{
			errors.push(wgStr.noClientCfg);
		}
	}
	return errors;
}

// ---- Remote Access Setup Wizard ----
//
// Thin orchestration over the page's own existing, unmodified functions
// (generateKeyPair, addWgClientModal/addAc, downloadAc, saveChanges) -- see
// docs/wizards/01-remote-access.md (gargoyle-tools repo) for the design
// rationale and the deviations from that spec's original sketch, both
// documented there and in the comments below at the point each applies.
//
// wizardClientId holds the allowed_client section id created by step 2, once
// known, so step 3 can build that specific client's config.
var wizardClientId = null;

function openRemoteAccessWizard()
{
	if(getSelectedValue("wireguard_config") == "client")
	{
		// This router is itself a road-warrior client elsewhere. Quick Setup is
		// for hosting access (server mode); switching modes here would silently
		// discard that existing client configuration, so refuse instead.
		document.getElementById("wireguard_wizard_blocked_message").innerText = wgStr.wgWizBlockedClient;
		showWizardPanel("blocked");
		modalPrepare('wireguard_wizard_modal', wgStr.wgWizTitle, [],
			["defaultDismiss"]);
		openModalWindow('wireguard_wizard_modal');
		return;
	}

	// Deliberately uci, not uciOriginal: saveChanges() does NOT do
	// uciOriginal=uci.clone() inline (it relies on a full page reload in
	// production instead, 5s after the save completes), so uciOriginal can be
	// stale within a session. Same fix as Guest Party Mode's own
	// openGuestPartyWizard(); applied here too since this check has the
	// identical failure mode.
	var serverEnabled = uci.get("wireguard_gargoyle", "server", "enabled");
	serverEnabled = serverEnabled == "1" || serverEnabled == "true";

	if(serverEnabled)
	{
		// Already set up. Don't re-key or touch existing settings -- go
		// straight to adding a device, reusing whatever's already configured.
		wizardOpenAddClient();
		return;
	}

	setSelectedValue("wireguard_config", "server");
	setWireguardVisibility();
	if(document.getElementById("wireguard_server_privkey").value == "")
	{
		generateKeyPair("server");
	}

	showWizardPanel("step1");
	modalPrepare('wireguard_wizard_modal', wgStr.wgWizTitle, [],
		[
			{"title" : wgStr.wgWizNext, "classes" : "btn btn-primary", "function" : wizardStep1Next},
			"defaultDismiss"
		]);
	openModalWindow('wireguard_wizard_modal');
}

function showWizardPanel(name)
{
	["blocked", "step1", "step3"].forEach(function(panel)
	{
		document.getElementById("wireguard_wizard_" + panel).style.display = panel == name ? "block" : "none";
	});
}

function wizardStep1Next()
{
	// The scope choice (LAN-only vs full-tunnel) is the server-wide
	// all_client_traffic setting, same field the full WireGuard page exposes
	// as "Clients Use Wireguard For". Setting it here now costs nothing either
	// way: DNS is pushed to the client in both tunnel modes (see
	// wg_client_config.js), so LAN-only no longer loses hostname resolution
	// the way it used to.
	document.getElementById("wireguard_server_redirect_gateway").value =
		getSelectedValue("wireguard_wizard_scope");

	closeModalWindow('wireguard_wizard_modal');
	wizardOpenAddClient();
}

function wizardOpenAddClient()
{
	// Reuses the real, unmodified add-client modal and its real addAc()
	// commit function -- this wizard step is not a second implementation of
	// client creation, just a thinner entry into the existing one. Only the
	// default name and automatic key generation are wizard-specific.
	addWgClientModal();
	document.getElementById("wireguard_allowed_client_name").value = wgStr.wgWizDeviceDefaultName;

	// addWgClientModal's own prefill (setAcDocumentFromUci) sets have_privkey to
	// "false" because no key exists yet at that point. generateKeyPair() only
	// fills the text fields, so without this, setAcUciFromDocument (gated on
	// have_privkey) would silently discard the key it just generated.
	setSelectedValue("wireguard_allowed_client_have_privkey", "true", document);
	setAllowedClientVisibility();
	generateKeyPair("allowed_client");

	// modalPrepare (called inside addWgClientModal) builds the Add button
	// fresh each time from a literal {..., "function": addAc} entry, with no
	// id to hook. It's the only .btn-primary in that modal's footer, so
	// rebinding it after the fact reaches the same button without needing to
	// change addWgClientModal itself.
	var addBtn = document.querySelector("#wireguard_allowed_client_modal_button_container .btn-primary");
	if(addBtn)
	{
		addBtn.onclick = wizardCommitClient;
	}
}

function wizardCommitClient()
{
	addAc();

	// addAc() validates, and on success commits the client into the live uci,
	// appends its table row, and closes the modal; on failure it alerts and
	// leaves the modal open for correction. The "in" class is exactly what
	// closeModalWindow/openModalWindow toggle, so its absence here is the same
	// success signal the rest of this file already relies on.
	if(!document.getElementById("wireguard_allowed_client_modal").classList.contains("in"))
	{
		var tbody = document.getElementById("wireguard_allowed_client_table").tBodies[0];
		var lastRow = tbody.rows[tbody.rows.length - 1];
		wizardClientId = lastRow.childNodes[1].firstChild.id;

		// saveChanges() must run before the config is built, not after: the
		// server fieldset's fields (ip, keys, all_client_traffic, ...) only get
		// written into uci inside saveChanges()'s own "server" branch. Before
		// that runs, uci has the new client (addAc() writes it directly) but not
		// the server, so a config built here first would come out with server ip
		// and keys blank. saveChanges() sets uci synchronously before kicking off
		// its own async persist, so the LOCAL uci (what the config is built
		// from) is already correct the moment saveChanges() returns -- but the
		// backend commit is still in flight at that point. wizardShowStep3() is
		// passed as saveChanges()'s completion callback rather than called
		// right after it, so the Download button only appears (and only
		// becomes clickable -- see wizardShowStep3()'s own comment) once that
		// commit has actually landed, not while it's still racing the
		// download's own separate backend request.
		saveChanges(wizardShowStep3, true);
	}
}

function wizardShowStep3()
{
	// saveChanges() (just called by wizardCommitClient()) leaves the
	// setControlsEnabled(false) wait overlay up on purpose for a plain Save
	// button -- it's cleared five seconds later by that same save's own
	// unconditional page reload, not by saveChanges() itself. That's fine
	// when nothing else is on screen, but this step renders a real,
	// actionable Download button UNDER that overlay: confirmed live that it
	// blocks every click for the entire five-second window, and the reload
	// then destroys the modal before a user ever gets a working click in.
	// saveChanges() already wrote the new client+server state into the local
	// uci synchronously before returning (wizardDownloadConfig()'s own
	// comment relies on exactly this), so the overlay's job is done as far
	// as this wizard is concerned -- clear it explicitly rather than wait on
	// a reload that arrives too late.
	setControlsEnabled(true);
	showWizardPanel("step3");
	modalPrepare('wireguard_wizard_modal', wgStr.wgWizTitle, [],
		[
			{"title" : wgStr.wgWizDone, "classes" : "btn btn-primary",
				"function" : function(){ closeModalWindow('wireguard_wizard_modal'); window.location=window.location; }},
		]);
	openModalWindow('wireguard_wizard_modal');
}

function wizardDownloadConfig()
{
	// downloadAc() reads from the live uci, which by this point (after
	// wizardCommitClient's saveChanges() call) reflects the same server+client
	// state that was just persisted. Calling it through the same fake-row
	// calling convention its real table-row click handler uses, rather than
	// duplicating its body, so the two never have a chance to drift.
	var fakeRow = { childNodes: [null, { firstChild: { id: wizardClientId } }] };
	downloadAc.call({ parentNode: { parentNode: fakeRow } });
}

// ---- Guest Party Mode ----
//
// Lets a user host a temporary, isolated WireGuard network for guests (a LAN
// party): guests see each other and the router, never the real home LAN. See
// docs/wizards/03-guest-network.md (gargoyle-tools repo) for the design
// rationale, and 01-remote-access.md for the QR/download handoff pattern this
// reuses (built there first; the QR-plugin runtime-detection check that
// spec's own text still describes was superseded during that build by an
// always-available-download design, applied identically here).
//
// wireguard_gargoyle has exactly one hardcoded server instance -- there is no
// way to run an isolated guest network alongside normal road-warrior access
// at the same time (that would need a genuinely second WireGuard interface,
// explicitly out of scope for v1). This is a MODE: it flips the same two
// server-wide settings the WireGuard page already exposes
// (wireguard_server_subnet_access / wireguard_server_client_to_client) for
// the duration of the party, and restores them exactly on "End Guest Party
// Mode" -- it does not add a new isolation mechanism.
//
// Pre-party lan_access/c2c are captured into new wireguard_gargoyle.server
// options (party_active, party_saved_lan_access, party_saved_c2c) rather than
// anything in /tmp, so "End Guest Party Mode" still works after a reboot
// mid-party.

var guestPartyClientId = null;

function openGuestPartyWizard()
{
	if(getSelectedValue("wireguard_config") == "client")
	{
		document.getElementById("wireguard_guest_party_blocked_message").innerText = wgStr.GPBlockedClient;
		guestPartyShowPanel("blocked");
		modalPrepare('wireguard_guest_party_modal', wgStr.GPTitle, [], ["defaultDismiss"]);
		openModalWindow('wireguard_guest_party_modal');
		return;
	}

	// Deliberately uci, not uciOriginal: unlike the Restrictions page,
	// wireguard.js's own saveChanges() does NOT do uciOriginal=uci.clone()
	// inline (it relies on a full page reload in production instead, 5s
	// after the save completes). Within that window, and in any test that
	// exercises more than one openGuestPartyWizard() call per session,
	// uciOriginal would still show pre-save state - checking uci is correct
	// both immediately after a local change and on a fresh page load (uci
	// starts as uciOriginal.clone() there too).
	if(uci.get("wireguard_gargoyle", "server", "party_active") == "1")
	{
		guestPartyShowPanel("active_notice");
		modalPrepare('wireguard_guest_party_modal', wgStr.GPTitle, [],
			[
				{"title" : wgStr.GPAddAnother, "classes" : "btn btn-default", "function" : guestPartyAddAnother},
				{"title" : wgStr.GPEnd, "classes" : "btn btn-warning", "function" : guestPartyEnd},
				"defaultDismiss"
			]);
		openModalWindow('wireguard_guest_party_modal');
		return;
	}

	var serverEnabled = uci.get("wireguard_gargoyle", "server", "enabled");
	serverEnabled = serverEnabled == "1" || serverEnabled == "true";

	if(!serverEnabled)
	{
		// Same guard as the Remote Access wizard: only touch server fields
		// (keys included) when there is no existing server to disturb.
		setSelectedValue("wireguard_config", "server");
		setWireguardVisibility();
		if(document.getElementById("wireguard_server_privkey").value == "")
		{
			generateKeyPair("server");
		}
	}

	var existingClients = uci.getAllSectionsOfType("wireguard_gargoyle", "allowed_client")
		.filter(function(id){ return uci.get("wireguard_gargoyle", id, "enabled") == "1"; });

	var warningEl = document.getElementById("wireguard_guest_party_warning");
	var countEl = document.getElementById("wireguard_guest_party_warning_count");
	if(existingClients.length > 0)
	{
		warningEl.innerText = wgStr.GPWarning;
		warningEl.style.display = "block";
		countEl.innerText = wgStr.GPWarningCountPfx + existingClients.length + wgStr.GPWarningCountSfx;
		countEl.style.display = "block";
	}
	else
	{
		warningEl.style.display = "none";
		countEl.style.display = "none";
	}

	guestPartyShowPanel("confirm");
	modalPrepare('wireguard_guest_party_modal', wgStr.GPTitle, [],
		[
			{"title" : wgStr.GPStart, "classes" : "btn btn-primary", "function" : guestPartyStart},
			"defaultDismiss"
		]);
	openModalWindow('wireguard_guest_party_modal');
}

function guestPartyShowPanel(name)
{
	["blocked", "confirm", "done", "active_notice", "ended"].forEach(function(panel)
	{
		document.getElementById("wireguard_guest_party_" + panel).style.display = panel == name ? "block" : "none";
	});
}

function guestPartyStart()
{
	// Capture BEFORE flipping. resetData() already populated these selects
	// from uciOriginal (or defaulted them, if the server was just enabled
	// above), so this is the genuine pre-party state either way.
	var savedLanAccess = getSelectedValue("wireguard_server_subnet_access");
	var savedC2c = getSelectedValue("wireguard_server_client_to_client");
	uci.set("wireguard_gargoyle", "server", "party_saved_lan_access", savedLanAccess);
	uci.set("wireguard_gargoyle", "server", "party_saved_c2c", savedC2c);
	uci.set("wireguard_gargoyle", "server", "party_active", "1");

	// One plain-language choice, not two separately-worded dropdowns: guests
	// can reach each other and the router (client-to-client on), never the
	// real LAN (subnet access off).
	document.getElementById("wireguard_server_subnet_access").value = "false";
	document.getElementById("wireguard_server_client_to_client").value = "true";

	closeModalWindow('wireguard_guest_party_modal');
	guestPartyOpenAddClient();
}

function guestPartyOpenAddClient()
{
	// Reuses the real, unmodified add-client modal and its real addAc()
	// commit function, exactly like the Remote Access wizard's own add-client
	// step -- see wizardOpenAddClient's own comment for why the have_privkey
	// fix below is needed.
	addWgClientModal();
	document.getElementById("wireguard_allowed_client_name").value = wgStr.GPDeviceDefaultName;
	setSelectedValue("wireguard_allowed_client_have_privkey", "true", document);
	setAllowedClientVisibility();
	generateKeyPair("allowed_client");

	var addBtn = document.querySelector("#wireguard_allowed_client_modal_button_container .btn-primary");
	if(addBtn)
	{
		addBtn.onclick = guestPartyCommitClient;
	}
}

function guestPartyCommitClient()
{
	addAc();

	if(!document.getElementById("wireguard_allowed_client_modal").classList.contains("in"))
	{
		var tbody = document.getElementById("wireguard_allowed_client_table").tBodies[0];
		var lastRow = tbody.rows[tbody.rows.length - 1];
		guestPartyClientId = lastRow.childNodes[1].firstChild.id;

		// saveChanges() must run before the config is built: server fields
		// (ip, keys, ...) and this wizard's own party_active/party_saved_*
		// options only land in uci's already-current values, but the FIREWALL
		// side (lan_wg_forwarding absent, wg_zone.forward=ACCEPT) is only
		// written inside saveChanges()'s own configureFirewall() closure, and
		// downloadAc()'s AllowedIPs depends on the LAN/subnet math being
		// correct regardless -- same reasoning as the Remote Access wizard's
		// own saveChanges()-before-build ordering. guestPartyShowDone() is
		// passed as the completion callback (not called right after) for the
		// same reason wizardShowStep3() is: showing its Download button before
		// the backend commit actually lands can race that button's own click
		// against saveChanges()'s still-in-flight persist.
		saveChanges(guestPartyShowDone, true);
	}
}

function guestPartyShowDone()
{
	// Same fix as wizardShowStep3(): saveChanges() (just called by
	// guestPartyCommitClient()) leaves the wait overlay up until its own
	// five-second-later reload, but this panel renders real Download/Add
	// Another buttons under it -- confirmed live (see wizardShowStep3's own
	// comment) that the overlay blocks every click for that whole window.
	// The local uci is already fully updated by this point, so it's safe to
	// clear the overlay here rather than let a too-late reload do it.
	setControlsEnabled(true);
	document.getElementById("wireguard_guest_party_done_message").innerText = wgStr.GPDone;
	guestPartyShowPanel("done");
	modalPrepare('wireguard_guest_party_modal', wgStr.GPTitle, [],
		[
			{"title" : wgStr.GPDone2, "classes" : "btn btn-primary",
				"function" : function(){ closeModalWindow('wireguard_guest_party_modal'); window.location=window.location; }},
		]);
	openModalWindow('wireguard_guest_party_modal');
}

function guestPartyDownloadConfig()
{
	// Same fake-row calling convention as the Remote Access wizard's
	// equivalent, so this never becomes a third generator of the config text.
	var fakeRow = { childNodes: [null, { firstChild: { id: guestPartyClientId } }] };
	downloadAc.call({ parentNode: { parentNode: fakeRow } });
}

function guestPartyAddAnother()
{
	closeModalWindow('wireguard_guest_party_modal');
	guestPartyOpenAddClient();
}

function guestPartyEnd()
{
	// uci, not uciOriginal -- see the comment in openGuestPartyWizard(). The
	// captured values were themselves written into uci by guestPartyStart(),
	// so within the same session (before any reload) uciOriginal would show
	// them as still absent.
	var savedLanAccess = uci.get("wireguard_gargoyle", "server", "party_saved_lan_access");
	var savedC2c = uci.get("wireguard_gargoyle", "server", "party_saved_c2c");
	// Fall back to the shipped defaults only if somehow no captured value
	// exists (e.g. party_active was set by hand outside the wizard) -- never
	// silently leave the isolation flip in place.
	savedLanAccess = savedLanAccess == "" ? "true" : savedLanAccess;
	savedC2c = savedC2c == "" ? "false" : savedC2c;

	document.getElementById("wireguard_server_subnet_access").value = savedLanAccess;
	document.getElementById("wireguard_server_client_to_client").value = savedC2c;
	uci.set("wireguard_gargoyle", "server", "party_active", "0");
	uci.remove("wireguard_gargoyle", "server", "party_saved_lan_access");
	uci.remove("wireguard_gargoyle", "server", "party_saved_c2c");

	closeModalWindow('wireguard_guest_party_modal');
	// Same reasoning as wizardCommitClient()/guestPartyCommitClient(): don't
	// tell the user isolation is restored until the backend commit that
	// actually restores it has landed, not just been kicked off.
	saveChanges(function()
	{
		// Same as wizardShowStep3()/guestPartyShowDone(): clear the wait
		// overlay ourselves now that the backend commit has landed, rather
		// than leave it blocking this panel's own Done button.
		setControlsEnabled(true);
		guestPartyShowPanel("ended");
		modalPrepare('wireguard_guest_party_modal', wgStr.GPTitle, [],
			[
				{"title" : wgStr.GPDone2, "classes" : "btn btn-primary",
					"function" : function(){ closeModalWindow('wireguard_guest_party_modal'); window.location=window.location; }},
			]);
		openModalWindow('wireguard_guest_party_modal');
	}, true);
}
