/*
 * This program is copyright © 2008-2013 Eric Bishop and is distributed under the terms of the GNU GPL
 * version 2.0 with a special clarification/exception that permits adapting the program to
 * configure proprietary "back end" software provided that all modifications to the web interface
 * itself remain covered by the GPL.
 * See http://gargoyle-router.com/faq.html#qfoss for more information
 */

var vlanStr = new Object(); // part of i18n

// In-memory source of truth for all four panels -- the port-assignment
// table's Native/Tagged select options and the access matrix's rows/columns
// both depend on the VLAN definitions table's current rows, so everything
// is rendered from these arrays rather than re-read from the DOM on every
// change.
var vlanDefs = [];
var portAssignments = [];
// accessMatrix[srcId][dstId] === true means srcId may reach dstId. srcId/
// dstId are 'lan' (Default LAN) or a VLAN id string. Absent/false = denied,
// which is the safe default for any newly-added VLAN.
var accessMatrix = {};
// {srcId, destIp, destZone, destPort, proto, desc} -- a hole punched through
// an otherwise-denied (or even allowed, doesn't matter) src/dest pair for
// one specific host:port, the same shape port_forwarding.js already uses for
// WAN-facing rules, just with a LAN-side zone pair instead of wan->lan.
var pinholes = [];

// ---- pure helpers (no DOM) -- unit tested directly, see tests/vlan/ ----

function ipIntToString(n)
{
	n = n >>> 0;
	return [(n>>>24)&255, (n>>>16)&255, (n>>>8)&255, n&255].join(".");
}

function cidrPrefixToNetmask(prefixLen)
{
	var n = prefixLen === 0 ? 0 : (0xFFFFFFFF << (32 - prefixLen)) >>> 0;
	return ipIntToString(n);
}

// Validates a VLAN ID against netifd's own hard limits (reject 0 and 4095)
// plus this feature's reserved id: VLAN 1 is always "Default LAN" (today's
// existing network.lan), not something a new row can redefine.
function validateVlanId(id, existingIds)
{
	if(!/^[0-9]+$/.test(id)) { return "invalid"; }
	var n = parseInt(id, 10);
	if(n === 1) { return "reserved"; }
	if(n < 1 || n > 4094) { return "range"; }
	if(existingIds.indexOf("" + n) > -1) { return "duplicate"; }
	return "ok";
}

// Parses "192.168.20.0/24" into {ok:true, routerIp, netmask, networkInt,
// broadcastInt} or {ok:false, reason}. Reuses common.js's getIpRangeIntegers
// (CIDR-aware) rather than hand-rolling subnet math twice.
function parseVlanSubnetCidr(cidrStr)
{
	if(!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(cidrStr)) { return {ok: false, reason: "format"}; }
	var parts = cidrStr.split("/");
	var octets = parts[0].split(".");
	for(var i = 0; i < octets.length; i++)
	{
		if(parseInt(octets[i], 10) > 255) { return {ok: false, reason: "format"}; }
	}
	var prefixLen = parseInt(parts[1], 10);
	if(prefixLen < 8 || prefixLen > 30) { return {ok: false, reason: "prefix"}; }

	var range = getIpRangeIntegers(cidrStr);
	var networkInt = range[0];
	var broadcastInt = range[1];
	var routerInt = networkInt + 1;
	if(routerInt >= broadcastInt) { return {ok: false, reason: "prefix"}; }

	return {
		ok: true,
		networkInt: networkInt,
		broadcastInt: broadcastInt,
		routerIp: ipIntToString(routerInt),
		netmask: cidrPrefixToNetmask(prefixLen)
	};
}

function vlanSubnetsOverlap(aNetworkInt, aBroadcastInt, bNetworkInt, bBroadcastInt)
{
	return aNetworkInt <= bBroadcastInt && bNetworkInt <= aBroadcastInt;
}

// The headline footgun's hard guardrail: refuse to save if not one single
// physical port would remain on Default LAN -- there's no legitimate reason
// to tag every port away from the trusted network simultaneously, and this
// is the one thing standing between a mistake and needing the safe-apply
// watchdog's 60s auto-revert to save you.
function hasTrustedPort(portList)
{
	for(var i = 0; i < portList.length; i++)
	{
		if(portList[i].native == 'lan') { return true; }
	}
	return false;
}

// zone name <-> VLAN id: 'lan' is the reserved Default LAN id AND its own
// firewall zone name (today's existing network.lan/dhcp.lan, unmanaged by
// this feature); every user VLAN's zone name is 'vlan' + id (matching the
// interface/dhcp section names saveChanges() already uses).
function zoneNameForId(id)
{
	return id == 'lan' ? 'lan' : 'vlan' + id;
}

function idForZoneName(name)
{
	return name == 'lan' ? 'lan' : name.replace(/^vlan/, '');
}

function getZoneList(defs)
{
	return [{id: 'lan', name: null}].concat(
		defs.map(function(d){ return {id: d.id, name: d.name}; })
	);
}

function zoneDisplayName(id, defs)
{
	if(id == 'lan') { return vlanStr.DefaultLan; }
	var def = defs.filter(function(d){ return d.id == id; })[0];
	return def ? (id + (def.name ? " (" + def.name + ")" : "")) : id;
}

// Which zone (Default LAN or a user VLAN id) a destination IP actually
// belongs to, by checking network.lan's own subnet then each VLAN's. Returns
// null if the IP falls outside every known subnet -- the pinhole table
// refuses to save in that case rather than writing an unreachable rule.
function findZoneForIp(ip, defs, lanIpaddr, lanNetmask)
{
	var ipInt = getIpInteger(ip);
	if(isNaN(ipInt)) { return null; }

	if(lanIpaddr && lanNetmask)
	{
		var lanRange = getIpRangeIntegers(lanIpaddr + "/" + lanNetmask);
		if(ipInt >= lanRange[0] && ipInt <= lanRange[1]) { return 'lan'; }
	}
	for(var i = 0; i < defs.length; i++)
	{
		var range = getIpRangeIntegers(defs[i].subnet);
		if(ipInt >= range[0] && ipInt <= range[1]) { return defs[i].id; }
	}
	return null;
}

// Flattens accessMatrix[src][dst]===true into a plain {src,dest} pair list,
// skipping the diagonal and any false/absent cell. Directional by
// construction: (guest,trusted) checked but (trusted,guest) unchecked
// produces exactly one pair, not two, since the two cells are independent
// entries in the source data to begin with.
function buildMatrixForwardingPairs(matrix)
{
	var pairs = [];
	Object.keys(matrix).forEach(function(srcId) {
		Object.keys(matrix[srcId]).forEach(function(destId) {
			if(matrix[srcId][destId] && srcId != destId) { pairs.push({src: srcId, dest: destId}); }
		});
	});
	return pairs;
}

// ---- UCI <-> in-memory parsing ----

function parseVlanDefsFromUci()
{
	var defs = [];
	var bridgeVlanSecs = uciOriginal.getAllSectionsOfType('network','bridge-vlan');
	bridgeVlanSecs.forEach(function(sec) {
		var m = sec.match(/^vlan_([0-9]+)$/);
		if(m === null || m[1] == '1') { return; } // vlan_1 is the reserved Default LAN
		var id = m[1];
		var ifaceName = 'vlan' + id;
		var ipaddr = uciOriginal.get('network', ifaceName, 'ipaddr');
		var netmask = uciOriginal.get('network', ifaceName, 'netmask');
		var prefixLen = netmask ? parseCidr(netmask) : 24;
		var networkAddr = ipaddr ? ipIntToString(getIpInteger(ipaddr) & getMaskInteger(prefixLen)) : '';
		var dhcpIgnore = uciOriginal.get('dhcp', ifaceName, 'ignore');

		defs.push({
			id: id,
			name: uciOriginal.get('network', sec, 'gargoyle_desc'),
			subnet: networkAddr + '/' + prefixLen,
			routerIp: ipaddr,
			netmask: netmask,
			dhcpEnabled: dhcpIgnore != '1',
			dhcpStart: uciOriginal.get('dhcp', ifaceName, 'start') || '100',
			dhcpLimit: uciOriginal.get('dhcp', ifaceName, 'limit') || '100'
		});
	});
	return defs;
}

// `ports` is injected server-side by vlan.sh (var ports = new Array(); then
// /usr/lib/gargoyle/switchinfo.sh), each entry [name, status, membership]
// where membership looks like "u10 t20 t30" (see switchinfo.sh's
// get_vlan_membership()). Untagged/native VLAN 1 reads back as the "lan"
// sentinel, matching how it's written on save.
function parsePortAssignmentsFromUci()
{
	if(typeof ports === 'undefined') { return []; }
	return ports.map(function(p) {
		var name = p[0], status = p[1], membership = p[2] || '';
		var native = 'lan';
		var tagged = [];
		membership.split(/\s+/).forEach(function(tok) {
			if(tok === '') { return; }
			var kind = tok.charAt(0);
			var vid = tok.substr(1);
			if(kind == 'u') { native = (vid == '1') ? 'lan' : vid; }
			else if(kind == 't' && vid != '1') { tagged.push(vid); }
		});
		return {name: name, status: status, native: native, tagged: tagged};
	});
}

// Matrix cells are stored as ordinary firewall `forwarding` sections named
// fwd_matrix_<src>_<dst> -- reads back only the ones between two zones this
// feature actually knows about (Default LAN or a currently-defined VLAN);
// a forwarding section left over from a since-deleted VLAN is silently
// dropped rather than resurrected, matching the clean-slate rebuild on save.
function parseMatrixFromUci(defs)
{
	var matrix = {};
	var knownIds = ['lan'].concat(defs.map(function(d){ return d.id; }));
	var knownZoneNames = knownIds.map(zoneNameForId);

	var fwdSecs = uciOriginal.getAllSectionsOfType('firewall','forwarding');
	fwdSecs.forEach(function(sec) {
		if(sec.match(/^fwd_matrix_/) === null) { return; }
		var src = uciOriginal.get('firewall', sec, 'src');
		var dest = uciOriginal.get('firewall', sec, 'dest');
		if(knownZoneNames.indexOf(src) === -1 || knownZoneNames.indexOf(dest) === -1) { return; }
		var srcId = idForZoneName(src);
		var destId = idForZoneName(dest);
		matrix[srcId] = matrix[srcId] || {};
		matrix[srcId][destId] = true;
	});
	return matrix;
}

// Pinhole rules are ordinary firewall `rule` sections named vlan_pinhole_N.
function parsePinholesFromUci(defs)
{
	var lanIpaddr = uciOriginal.get('network','lan','ipaddr');
	var lanNetmask = uciOriginal.get('network','lan','netmask');
	var result = [];

	var ruleSecs = uciOriginal.getAllSectionsOfType('firewall','rule');
	ruleSecs.forEach(function(sec) {
		if(sec.match(/^vlan_pinhole_/) === null) { return; }
		var src = uciOriginal.get('firewall', sec, 'src');
		var destIp = uciOriginal.get('firewall', sec, 'dest_ip');
		var destZone = findZoneForIp(destIp, defs, lanIpaddr, lanNetmask);
		result.push({
			srcId: idForZoneName(src),
			destIp: destIp,
			destZone: destZone,
			destPort: uciOriginal.get('firewall', sec, 'dest_port'),
			proto: uciOriginal.get('firewall', sec, 'proto') || 'tcp',
			desc: uciOriginal.get('firewall', sec, 'name')
		});
	});
	return result;
}

// ---- rendering ----

function renderVlanDefsTable()
{
	var container = document.getElementById('vlan_defs_table_container');
	container.innerHTML = "";
	var rows = vlanDefs.map(function(d) {
		return [d.id, d.name, d.subnet, d.dhcpEnabled ? vlanStr.Enabled : vlanStr.Disabled];
	});
	var table = createTable([vlanStr.IdCol, vlanStr.NameCol, vlanStr.SubnetCol, vlanStr.DhcpCol], rows, "vlan_defs_table", true, false, onVlanRowRemoved);
	container.appendChild(table);
}

function onVlanRowRemoved(table, row)
{
	var id = row.cells[0].textContent;
	vlanDefs = vlanDefs.filter(function(d){ return d.id != id; });
	portAssignments.forEach(function(p) {
		if(p.native == id) { p.native = 'lan'; }
		p.tagged = p.tagged.filter(function(t){ return t != id; });
	});

	delete accessMatrix[id];
	Object.keys(accessMatrix).forEach(function(src) { delete accessMatrix[src][id]; });
	pinholes = pinholes.filter(function(p) { return p.srcId != id && p.destZone != id; });

	renderPortsTable();
	renderMatrixTable();
	renderPinholeTable();
}

function renderPortsTable()
{
	var container = document.getElementById('vlan_ports_table_container');
	container.innerHTML = "";

	var nativeOptions = [{value: 'lan', text: vlanStr.DefaultLan}].concat(
		vlanDefs.map(function(d){ return {value: d.id, text: d.id + (d.name ? " (" + d.name + ")" : "")}; })
	);

	var rows = portAssignments.map(function(p) {
		var nativeSelect = document.createElement('select');
		nativeSelect.className = 'form-control';
		nativeOptions.forEach(function(opt) {
			var o = document.createElement('option');
			o.value = opt.value;
			o.textContent = opt.text;
			o.selected = (opt.value == p.native);
			nativeSelect.appendChild(o);
		});
		nativeSelect.onchange = function() { p.native = this.value; };

		var taggedSelect = document.createElement('select');
		taggedSelect.className = 'form-control';
		taggedSelect.multiple = true;
		taggedSelect.size = Math.min(4, Math.max(2, vlanDefs.length));
		vlanDefs.forEach(function(d) {
			var o = document.createElement('option');
			o.value = d.id;
			o.textContent = d.id + (d.name ? " (" + d.name + ")" : "");
			o.selected = p.tagged.indexOf(d.id) > -1;
			taggedSelect.appendChild(o);
		});
		taggedSelect.onchange = function() {
			p.tagged = Array.prototype.filter.call(this.options, function(o){ return o.selected; }).map(function(o){ return o.value; });
		};

		return [p.name, p.status, nativeSelect, taggedSelect];
	});

	var table = createTable([vlanStr.PortCol, vlanStr.StatusCol, vlanStr.NativeCol, vlanStr.TaggedCol], rows, "vlan_ports_table", false, false);
	container.appendChild(table);
}

// Access matrix: rows = source zone, columns = destination zone, diagonal
// excluded (a zone always reaches itself). Every cell defaults unchecked
// (deny) for a newly-added VLAN -- safe by default, same spirit as the old
// single isolate toggle this replaces. WAN reachability is separate and
// unconditional (each VLAN's own fwd_vlan<id>_wan section from saveChanges'
// per-VLAN block), not part of this LAN-peer-to-LAN-peer grid.
function renderMatrixTable()
{
	var container = document.getElementById('vlan_matrix_table_container');
	container.innerHTML = "";

	var zones = getZoneList(vlanDefs);
	if(zones.length < 2)
	{
		container.innerHTML = "<div class=\"alert alert-info\">" + vlanStr.MatrixNeedsTwo + "</div>";
		return;
	}

	var table = document.createElement('table');
	table.className = 'table table-striped table-bordered';
	table.id = 'vlan_matrix_table';

	var thead = document.createElement('thead');
	var headRow = document.createElement('tr');
	headRow.appendChild(document.createElement('th'));
	zones.forEach(function(z) {
		var th = document.createElement('th');
		th.textContent = zoneDisplayName(z.id, vlanDefs);
		headRow.appendChild(th);
	});
	thead.appendChild(headRow);
	table.appendChild(thead);

	var tbody = document.createElement('tbody');
	zones.forEach(function(srcZone) {
		var row = document.createElement('tr');
		var rowHeader = document.createElement('th');
		rowHeader.textContent = zoneDisplayName(srcZone.id, vlanDefs);
		row.appendChild(rowHeader);

		zones.forEach(function(dstZone) {
			var cell = document.createElement('td');
			cell.className = 'text-center';
			if(srcZone.id == dstZone.id)
			{
				cell.textContent = "-";
			}
			else
			{
				var checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.checked = !!(accessMatrix[srcZone.id] && accessMatrix[srcZone.id][dstZone.id]);
				checkbox.onchange = function() {
					accessMatrix[srcZone.id] = accessMatrix[srcZone.id] || {};
					accessMatrix[srcZone.id][dstZone.id] = this.checked;
				};
				cell.appendChild(checkbox);
			}
			row.appendChild(cell);
		});
		tbody.appendChild(row);
	});
	table.appendChild(tbody);
	container.appendChild(table);
}

function renderPinholeTable()
{
	var container = document.getElementById('vlan_pinhole_table_container');
	container.innerHTML = "";
	var rows = pinholes.map(function(p) {
		return [zoneDisplayName(p.srcId, vlanDefs), p.destIp, p.destPort || vlanStr.AnyPort, p.proto.toUpperCase(), p.desc];
	});
	var table = createTable([vlanStr.PinholeSrcCol, vlanStr.PinholeIpCol, vlanStr.PinholePortCol, vlanStr.PinholeProtoCol, vlanStr.PinholeDescCol], rows, "vlan_pinhole_table", true, false, onPinholeRowRemoved);
	var domRows = table.tBodies[0].rows;
	for(var i = 0; i < domRows.length; i++) { domRows[i]._pinhole = pinholes[i]; }
	container.appendChild(table);

	refreshPinholeSrcOptions();
}

// The pinhole "Source VLAN" select's options track the VLAN definitions
// table exactly like the port table's Native/Tagged selects do -- rebuilt
// wherever vlanDefs changes (add, remove, and the initial render).
function refreshPinholeSrcOptions()
{
	var zones = getZoneList(vlanDefs);
	var values = zones.map(function(z){ return z.id; });
	var names = zones.map(function(z){ return zoneDisplayName(z.id, vlanDefs); });
	setAllowableSelections('add_pinhole_src', values, names);
}

function onPinholeRowRemoved(table, row)
{
	var target = row._pinhole;
	pinholes = pinholes.filter(function(p){ return p !== target; });
}

// ---- add / validate ----

function addVlan()
{
	var idField = document.getElementById('add_vlan_id');
	var nameField = document.getElementById('add_vlan_name');
	var subnetField = document.getElementById('add_vlan_subnet');
	var dhcpField = document.getElementById('add_vlan_dhcp');

	var id = idField.value;
	var existingIds = vlanDefs.map(function(d){ return d.id; });
	var idResult = validateVlanId(id, existingIds);
	if(idResult != "ok")
	{
		alert(vlanS_idError(idResult));
		return;
	}

	var subnetResult = parseVlanSubnetCidr(subnetField.value);
	if(!subnetResult.ok)
	{
		alert(vlanS_subnetError(subnetResult.reason));
		return;
	}

	var lanIp = uciOriginal.get('network','lan','ipaddr');
	var lanMask = uciOriginal.get('network','lan','netmask');
	if(lanIp && lanMask)
	{
		var lanRange = getIpRangeIntegers(lanIp + "/" + lanMask);
		if(vlanSubnetsOverlap(subnetResult.networkInt, subnetResult.broadcastInt, lanRange[0], lanRange[1]))
		{
			alert(vlanStr.SubnetOverlapErr);
			return;
		}
	}
	for(var i = 0; i < vlanDefs.length; i++)
	{
		var other = vlanDefs[i];
		var otherRange = getIpRangeIntegers(other.subnet);
		if(vlanSubnetsOverlap(subnetResult.networkInt, subnetResult.broadcastInt, otherRange[0], otherRange[1]))
		{
			alert(vlanStr.SubnetOverlapErr);
			return;
		}
	}

	vlanDefs.push({
		id: id,
		name: nameField.value,
		subnet: subnetField.value,
		routerIp: subnetResult.routerIp,
		netmask: subnetResult.netmask,
		dhcpEnabled: dhcpField.checked,
		dhcpStart: '100',
		dhcpLimit: '100'
	});

	idField.value = "";
	nameField.value = "";
	subnetField.value = "";
	dhcpField.checked = true;

	renderVlanDefsTable();
	renderPortsTable();
	renderMatrixTable();
	renderPinholeTable();
}

function vlanS_idError(reason)
{
	if(reason == "reserved") { return vlanStr.IdReservedErr; }
	if(reason == "duplicate") { return vlanStr.IdDupErr; }
	return vlanStr.IdRangeErr;
}

function vlanS_subnetError(reason)
{
	if(reason == "prefix") { return vlanStr.SubnetPrefixErr; }
	return vlanStr.SubnetFormatErr;
}

function addPinhole()
{
	var srcSelect = document.getElementById('add_pinhole_src');
	var ipField = document.getElementById('add_pinhole_ip');
	var portField = document.getElementById('add_pinhole_port');
	var protoSelect = document.getElementById('add_pinhole_proto');
	var descField = document.getElementById('add_pinhole_desc');

	var srcId = srcSelect.value;
	var destIp = ipField.value;
	var destPort = portField.value;
	var proto = protoSelect.value;

	if(validateIP(destIp) != 0)
	{
		alert(vlanStr.PinholeIpErr);
		return;
	}
	var lanIpaddr = uciOriginal.get('network','lan','ipaddr');
	var lanNetmask = uciOriginal.get('network','lan','netmask');
	var destZone = findZoneForIp(destIp, vlanDefs, lanIpaddr, lanNetmask);
	if(destZone === null)
	{
		alert(vlanStr.PinholeIpUnknownErr);
		return;
	}
	if(destZone == srcId)
	{
		alert(vlanStr.PinholeSameZoneErr);
		return;
	}
	if(destPort !== "" && !/^[0-9]+$/.test(destPort))
	{
		alert(vlanStr.PinholePortErr);
		return;
	}
	var isDup = pinholes.some(function(p) {
		return p.srcId == srcId && p.destIp == destIp && p.destPort == destPort && p.proto == proto;
	});
	if(isDup)
	{
		alert(vlanStr.PinholeDupErr);
		return;
	}

	pinholes.push({srcId: srcId, destIp: destIp, destZone: destZone, destPort: destPort, proto: proto, desc: descField.value});

	ipField.value = "";
	portField.value = "";
	descField.value = "";

	renderPinholeTable();
}

function proofreadAll()
{
	var errors = [];
	if(vlanDefs.length > 0 && !hasTrustedPort(portAssignments))
	{
		errors.push(vlanStr.NoTrustedPortErr);
	}
	return errors;
}

// ---- save ----

function saveChanges()
{
	var errors = proofreadAll();
	if(errors.length > 0)
	{
		alert(errors.join("\n") + "\n\n" + UI.ErrChanges);
		return;
	}

	setControlsEnabled(false, true);

	var uci = uciOriginal.clone();

	// Match existing VLAN/matrix/pinhole sections to the current in-memory
	// model by identity instead of unconditionally deleting every
	// VLAN-manager-owned section this tab's uciOriginal knows about and
	// rebuilding all of them fresh -- the same corruption class fixed in
	// dhcp.js's saveChanges() (see ispyisail/gargoyle#26). A VLAN this tab
	// never touched, or a matrix/pinhole entry another tab already saved,
	// no longer gets silently reverted the moment this tab saves anything
	// at all. Only a section whose identity genuinely no longer exists in
	// the current model (VLAN removed, matrix cell unchecked, pinhole row
	// deleted) gets torn down.
	//
	// VLAN definitions already use a stable, deterministic section name
	// (vlan_<id>, keyed by the user-chosen VLAN ID, not row position) --
	// only VLANs actually removed from vlanDefs need deleting. The access
	// matrix moves from positional fwd_matrix_<idx> naming to deterministic
	// fwd_matrix_<src>_<dest> naming, since a (src,dest) pair is already a
	// unique identity by construction (one checkbox per pair) -- no lookup
	// needed at all, just delete whichever previously-true pairs are no
	// longer checked. Pinholes have no such natural section-name identity
	// (a rule's dest_ip/dest_port/proto aren't valid section-name
	// characters), so they use the same match-by-content-and-reuse approach
	// as the other fixed pages.
	var currentVlanIds = {};
	vlanDefs.forEach(function(d) { currentVlanIds[d.id] = true; });
	var bridgeVlanSecs = uci.getAllSectionsOfType('network','bridge-vlan');
	bridgeVlanSecs.forEach(function(sec) {
		var m = sec.match(/^vlan_([0-9]+)$/);
		if(m === null) { return; }
		var vid = m[1];
		if(vid == '1' || currentVlanIds[vid]) { return; } // reserved, or still defined -- reused below
		uci.removeSection('network', sec);
		uci.removeSection('network', 'vlan' + vid);
		uci.removeSection('dhcp', 'vlan' + vid);
		uci.removeSection('firewall', 'zone_vlan' + vid);
		uci.removeSection('firewall', 'fwd_vlan' + vid + '_wan');
	});

	var currentMatrixPairs = {};
	buildMatrixForwardingPairs(accessMatrix).forEach(function(pair) {
		currentMatrixPairs['fwd_matrix_' + pair.src + '_' + pair.dest] = true;
	});
	uci.getAllSectionsOfType('firewall','forwarding').forEach(function(sec) {
		if(sec.match(/^fwd_matrix_/) !== null && currentMatrixPairs[sec] == null) { uci.removeSection('firewall', sec); }
	});

	var pinholeByKey = {};
	var pinholeMaxIdx = -1;
	uci.getAllSectionsOfType('firewall','rule').forEach(function(sec) {
		if(sec.match(/^vlan_pinhole_/) === null) { return; }
		var key = uci.get('firewall', sec, 'src') + "|" + uci.get('firewall', sec, 'dest') + "|" + uci.get('firewall', sec, 'dest_ip') + "|" + uci.get('firewall', sec, 'dest_port') + "|" + uci.get('firewall', sec, 'proto');
		pinholeByKey[key] = sec;
		var m = sec.match(/^vlan_pinhole_(\d+)$/);
		if(m != null) { pinholeMaxIdx = Math.max(pinholeMaxIdx, parseInt(m[1], 10)); }
	});
	var pinholeMatched = {};

	if(vlanDefs.length == 0)
	{
		// Feature not in use (or just turned off): leave vlan_filtering
		// alone unless we're the ones who turned it on previously.
		if(uciOriginal.get('network','brlan_dev','vlan_filtering') == '1')
		{
			uci.remove('network', 'brlan_dev', 'vlan_filtering');
			uci.set('network', 'lan', 'device', 'br-lan');
		}
	}
	else
	{
		uci.set('network', 'brlan_dev', 'vlan_filtering', '1');

		var vlan1Ports = [];
		portAssignments.forEach(function(p) {
			if(p.native == 'lan') { vlan1Ports.push(p.name + ':u*'); }
			if(p.tagged.indexOf('1') > -1) { vlan1Ports.push(p.name + ':t'); }
		});
		uci.set('network', 'vlan_1', '', 'bridge-vlan');
		uci.set('network', 'vlan_1', 'device', 'br-lan');
		uci.set('network', 'vlan_1', 'vlan', '1');
		uci.createListOption('network', 'vlan_1', 'ports', true);
		uci.set('network', 'vlan_1', 'ports', vlan1Ports);

		// Once vlan_filtering is on, the bare br-lan device is just the
		// switch fabric -- it no longer has a "default" VLAN identity of
		// its own. network.lan (the pre-existing Default LAN interface)
		// must move onto VLAN 1's own dedicated sub-device, exactly like
		// every user VLAN gets its own br-lan.<id>, or the router's own
		// LAN IP stops being reachable entirely even though port-to-port
		// forwarding between other devices keeps working -- confirmed live
		// (vnet phase 28): ARP requests for the router's LAN IP visibly
		// arrived at the guest's NIC but were never replied to until this
		// was set, while two other devices on the same VLAN could still
		// reach each other the whole time.
		uci.set('network', 'lan', 'device', 'br-lan.1');

		vlanDefs.forEach(function(def) {
			var vsec = 'vlan_' + def.id;
			var ifaceName = 'vlan' + def.id;

			var portsForThisVlan = [];
			portAssignments.forEach(function(p) {
				if(p.native == def.id) { portsForThisVlan.push(p.name + ':u*'); }
				if(p.tagged.indexOf(def.id) > -1) { portsForThisVlan.push(p.name + ':t'); }
			});

			uci.set('network', vsec, '', 'bridge-vlan');
			uci.set('network', vsec, 'device', 'br-lan');
			uci.set('network', vsec, 'vlan', def.id);
			uci.set('network', vsec, 'gargoyle_desc', def.name);
			uci.createListOption('network', vsec, 'ports', true);
			uci.set('network', vsec, 'ports', portsForThisVlan);

			uci.set('network', ifaceName, '', 'interface');
			uci.set('network', ifaceName, 'device', 'br-lan.' + def.id);
			uci.set('network', ifaceName, 'proto', 'static');
			uci.set('network', ifaceName, 'ipaddr', def.routerIp);
			uci.set('network', ifaceName, 'netmask', def.netmask);

			uci.set('dhcp', ifaceName, '', 'dhcp');
			uci.set('dhcp', ifaceName, 'interface', ifaceName);
			if(def.dhcpEnabled)
			{
				uci.set('dhcp', ifaceName, 'start', def.dhcpStart);
				uci.set('dhcp', ifaceName, 'limit', def.dhcpLimit);
				uci.set('dhcp', ifaceName, 'leasetime', '12h');
			}
			else
			{
				uci.set('dhcp', ifaceName, 'ignore', '1');
			}

			// Own zone, always WAN-reachable. Whether it can also reach any
			// OTHER LAN-side zone is entirely the access matrix's call (built
			// below as separate `forwarding` sections) -- deny is simply the
			// absence of one, matching how the default lan/wan stanzas work.
			//
			// input MUST be ACCEPT, matching the default `lan` zone (never
			// REJECT) -- `input` governs traffic addressed to the router
			// ITSELF from this zone, and DHCP/DNS requests are addressed to
			// the router. REJECT here doesn't just block admin-UI access to
			// the VLAN's own gateway (arguably a defensible default); it
			// silently breaks the VLAN's own DHCP server, since a client's
			// DHCPDISCOVER never reaches dnsmasq at all -- confirmed live via
			// vnet phase 28 (T-VLAN-02/06/07 all failed on a REJECT-input
			// zone; a real `busybox udhcpc` got zero offers). Inter-VLAN
			// isolation is what `forward` (REJECT here, absence of a matrix
			// entry) and the access matrix are for; `input` isolating the
			// VLAN from the router's own basic services isn't isolation,
			// it's just breakage.
			uci.set('firewall', 'zone_' + ifaceName, '', 'zone');
			uci.set('firewall', 'zone_' + ifaceName, 'name', ifaceName);
			uci.createListOption('firewall', 'zone_' + ifaceName, 'network', true);
			uci.set('firewall', 'zone_' + ifaceName, 'network', [ifaceName]);
			uci.set('firewall', 'zone_' + ifaceName, 'input', 'ACCEPT');
			uci.set('firewall', 'zone_' + ifaceName, 'output', 'ACCEPT');
			uci.set('firewall', 'zone_' + ifaceName, 'forward', 'REJECT');
			uci.set('firewall', 'fwd_' + ifaceName + '_wan', '', 'forwarding');
			uci.set('firewall', 'fwd_' + ifaceName + '_wan', 'src', ifaceName);
			uci.set('firewall', 'fwd_' + ifaceName + '_wan', 'dest', 'wan');
		});

		// Access matrix: one forwarding section per checked (src,dest) cell,
		// named deterministically after that pair -- no lookup needed, and
		// unrelated cells this tab didn't touch are never referenced at all.
		buildMatrixForwardingPairs(accessMatrix).forEach(function(pair) {
			var sec = 'fwd_matrix_' + pair.src + '_' + pair.dest;
			uci.set('firewall', sec, '', 'forwarding');
			uci.set('firewall', sec, 'src', zoneNameForId(pair.src));
			uci.set('firewall', sec, 'dest', zoneNameForId(pair.dest));
		});

		// Pinhole exceptions: one host/port-specific ACCEPT rule per row,
		// the same rule shape port_forwarding.js already writes for
		// WAN-facing open-port rules, just with a LAN-side zone pair.
		// Matched to an existing section by its actual content (no stable
		// section-name identity is possible here -- an IP/port aren't valid
		// section-name characters), reusing it so an unrelated pinhole this
		// tab didn't touch never gets rewritten.
		pinholes.forEach(function(p) {
			var srcZone = zoneNameForId(p.srcId);
			var destZone = zoneNameForId(p.destZone);
			var key = srcZone + "|" + destZone + "|" + p.destIp + "|" + p.destPort + "|" + p.proto;
			var sec = pinholeByKey[key];
			if(sec != null)
			{
				pinholeMatched[sec] = true;
			}
			else
			{
				sec = 'vlan_pinhole_' + (++pinholeMaxIdx);
				uci.set('firewall', sec, '', 'rule');
			}
			uci.set('firewall', sec, 'name', p.desc);
			uci.set('firewall', sec, 'src', srcZone);
			uci.set('firewall', sec, 'dest', destZone);
			uci.set('firewall', sec, 'dest_ip', p.destIp);
			if(p.destPort !== "") { uci.set('firewall', sec, 'dest_port', p.destPort); } else { uci.remove('firewall', sec, 'dest_port'); }
			uci.set('firewall', sec, 'proto', p.proto);
			uci.set('firewall', sec, 'family', 'ipv4');
			uci.set('firewall', sec, 'target', 'ACCEPT');
		});

		// Any pinhole section this tab knew about that no current row still
		// maps to (by content) was actually removed by the user in this tab.
		Object.keys(pinholeByKey).forEach(function(key) {
			var sec = pinholeByKey[key];
			if(pinholeMatched[sec] == null) { uci.removeSection('firewall', sec); }
		});
	}

	var commands = uci.getScriptCommands(uciOriginal) + "\nsh /usr/lib/gargoyle/restart_network.sh ;\n";

	var onApplied = function(req)
	{
		uciOriginal = uci.clone();
		resetData();
		setControlsEnabled(true);
	}
	safeApplyRun(commands, {timeout: 60, onApplied: onApplied});
}

// ---- entry point ----

function resetData()
{
	var hwLabel = document.getElementById("hw_model_label");
	if(vlanHwModel === "dsa") { hwLabel.textContent = vlanStr.HWDsa; }
	else if(vlanHwModel === "swconfig") { hwLabel.textContent = vlanStr.HWSwconfig; }
	else { hwLabel.textContent = vlanStr.HWNone; }

	setVisibility(['vlan_manager_panel'], vlanHwModel === "dsa" ? [1] : [0]);
	setVisibility(['vlan_unsupported_panel'], vlanHwModel === "dsa" ? [0] : [1]);

	if(vlanHwModel !== "dsa") { return; }

	vlanDefs = parseVlanDefsFromUci();
	portAssignments = parsePortAssignmentsFromUci();
	accessMatrix = parseMatrixFromUci(vlanDefs);
	pinholes = parsePinholesFromUci(vlanDefs);

	renderVlanDefsTable();
	renderPortsTable();
	renderMatrixTable();
	renderPinholeTable();
}
