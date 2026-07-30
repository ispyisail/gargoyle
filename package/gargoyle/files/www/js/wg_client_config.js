// Shared WireGuard road-warrior client-config generation, used by both
// plugin-gargoyle-wireguard's own client download and plugin-gargoyle-qr-code's
// QR rendering. Depends only on the common_js helpers already global on every
// page (parseIp, ipToStr, parseCidr, ip6addr2bin, ip6bin2addr, ip6_canonical,
// ip6_mask) -- no other dependency, so any page can load this file via -j.
//
// This exists because the same artifact used to be generated in two separate
// places by two separate implementations, and they drifted: one received a DNS
// push fix and a split-tunnel routing fix that the other never did. See
// docs/wizards/04-dedup-wg-client-config.md in the gargoyle-tools repo.

// Deterministic IPv6 tunnel address for a downloaded (road-warrior) client, in
// the absence of an explicit v6 pool: take the server's v6 /prefix and embed the
// client's v4 host octet in the low 8 bits. Since road-warrior v4 IPs are unique
// within the server's internal subnet (getUnusedAcIp), the derived v6 host is
// unique too. Needs at least 8 host bits (prefix <= 120); returns "" otherwise.
function wgDeriveClientIp6(serverIp6, prefixLen, clientIp4)
{
	prefixLen = prefixLen * 1;
	if(serverIp6 == "" || isNaN(prefixLen) || prefixLen < 1 || prefixLen > 120)
	{
		return "";
	}
	var lastOctet = parseInt(clientIp4.split(".").pop(), 10);
	if(isNaN(lastOctet))
	{
		return "";
	}
	var bin = ip6addr2bin(serverIp6);
	var octetBin = ("00000000" + lastOctet.toString(2)).substr(-8);
	var host = "0".repeat(128 - prefixLen - 8) + octetBin;
	return ip6_canonical(ip6bin2addr(bin.substr(0, prefixLen) + host));
}

// Build a { iface, peer } structured WireGuard client config for the
// allowed_client section named clientId, from wireguard_gargoyle UCI state.
// lanIp/lanMask are passed explicitly (the router's own LAN address/mask, as
// held in each page's currentLanIp/currentLanMask globals) rather than read
// from a page global, so this stays unit-testable without faking page state.
function wgBuildClientConfig(uciCtx, clientId, lanIp, lanMask)
{
	var wgServerIP = uciCtx.get("wireguard_gargoyle", "server", "ip");
	var wgServerLanMask = uciCtx.get("wireguard_gargoyle", "server", "submask");
	var wgServerIP6 = uciCtx.get("wireguard_gargoyle", "server", "ip6");
	var wgServerLanMask6 = uciCtx.get("wireguard_gargoyle", "server", "submask6");
	var haveServerV6 = wgServerIP6 != "" && wgServerLanMask6 != "";
	var allClientTraffic = uciCtx.get("wireguard_gargoyle", "server", "all_client_traffic");

	var intaddr = uciCtx.get("wireguard_gargoyle", clientId, "ip") + "/32";
	if(haveServerV6)
	{
		var clientIp6 = wgDeriveClientIp6(wgServerIP6, wgServerLanMask6, uciCtx.get("wireguard_gargoyle", clientId, "ip"));
		if(clientIp6 != "")
		{
			intaddr = intaddr + "," + clientIp6 + "/128";
		}
	}

	// The server's tunnel address sits inside the Wireguard subnet, which the
	// AllowedIPs block below routes in split-tunnel mode as well as full-tunnel,
	// so the client can always reach it as a resolver.
	var iface = {
		address: intaddr,
		dns: wgServerIP,
		privateKey: uciCtx.get("wireguard_gargoyle", clientId, "private_key"),
		publicKey: uciCtx.get("wireguard_gargoyle", clientId, "public_key"),
	};

	var prroutedips = ["0.0.0.0/0"];
	if(allClientTraffic == "true" && haveServerV6)
	{
		prroutedips.push("::/0");
	}
	if(allClientTraffic == "false")
	{
		prroutedips = [ipToStr(parseIp(wgServerIP) & parseIp(wgServerLanMask)) + "/" + parseCidr(wgServerLanMask)];
		prroutedips.push(ipToStr(parseIp(lanIp) & parseIp(lanMask)) + "/" + parseCidr(lanMask));
		if(haveServerV6)
		{
			// The WireGuard internal v6 network, so the client can reach the server
			// and other peers' tunnel addresses.
			prroutedips.push(ip6_mask(wgServerIP6, wgServerLanMask6) + "/" + wgServerLanMask6);
		}
		var wgACs = uciCtx.getAllSectionsOfType("wireguard_gargoyle", "allowed_client");
		var wgACIdx;
		for(wgACIdx = 0; wgACIdx < wgACs.length; wgACIdx++)
		{
			if(uciCtx.get("wireguard_gargoyle", wgACs[wgACIdx], "enabled") == "1" && uciCtx.get("wireguard_gargoyle", wgACs[wgACIdx], "id") != clientId)
			{
				var subnetip = uciCtx.get("wireguard_gargoyle", wgACs[wgACIdx], "subnet_ip");
				var subnetmask = uciCtx.get("wireguard_gargoyle", wgACs[wgACIdx], "subnet_mask");
				if(subnetip != "" && subnetmask != "")
				{
					prroutedips.push(subnetip + "/" + parseCidr(subnetmask));
				}
				var subnetip6 = uciCtx.get("wireguard_gargoyle", wgACs[wgACIdx], "subnet_ip6");
				var subnetmask6 = uciCtx.get("wireguard_gargoyle", wgACs[wgACIdx], "subnet_mask6");
				if(subnetip6 != "" && subnetmask6 != "")
				{
					prroutedips.push(subnetip6 + "/" + subnetmask6);
				}
			}
		}
	}

	var peer = {
		allowedIPs: prroutedips.join(","),
		endpoint: uciCtx.get("wireguard_gargoyle", clientId, "remote") + ":" + uciCtx.get("wireguard_gargoyle", "server", "port"),
		publicKey: uciCtx.get("wireguard_gargoyle", "server", "public_key"),
	};

	return { iface: iface, peer: peer };
}

// Render a { iface, peer } config (as built by wgBuildClientConfig) to WireGuard
// .conf text. DNS is only emitted when iface.dns is set, so a caller with no
// resolver still produces a valid config.
function wgRenderClientConfig(iface, peer)
{
	var lines = [
		"[Interface]",
		"Address = " + iface.address,
	];
	if(iface.dns)
	{
		lines.push("DNS = " + iface.dns);
	}
	lines = lines.concat([
		"PrivateKey = " + iface.privateKey,
		"",
		"[Peer]",
		"AllowedIPs = " + peer.allowedIPs,
		"Endpoint = " + peer.endpoint,
		"PersistentKeepalive = 25",
		"PublicKey = " + peer.publicKey,
	]);
	return lines.join("\n");
}
