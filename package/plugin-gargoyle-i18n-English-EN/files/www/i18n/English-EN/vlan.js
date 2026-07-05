/*
 * UTF-8 (with BOM) English-EN text strings for vlan.sh html elements
 */

vlanStr.Title="VLAN Settings";
vlanStr.HWModel="Hardware VLAN Model";
vlanStr.HWDsa="DSA (Distributed Switch Architecture)";
vlanStr.HWSwconfig="swconfig (legacy switch)";
vlanStr.HWNone="No hardware switch detected";
vlanStr.NotSupported="VLAN management is only supported on DSA-based hardware. This device uses the older swconfig switch driver, which this feature does not manage.";
vlanStr.Enabled="Enabled";
vlanStr.Disabled="Disabled";

vlanStr.VlanDefsSect="VLANs";
vlanStr.IdCol="VLAN ID";
vlanStr.NameCol="Name";
vlanStr.SubnetCol="Subnet";
vlanStr.SubnetPlaceholder="e.g. 192.168.20.0/24";
vlanStr.DhcpCol="DHCP";

vlanStr.PortAssignSect="Port Assignment";
vlanStr.PortAssignHelp="Each port's Native VLAN carries untagged traffic (the right choice for a plain device that has no VLAN awareness of its own, like a printer or a basic switch). A port can also carry any number of Tagged VLANs at the same time (for a trunk link to an access point or managed switch).";
vlanStr.PortCol="Port";
vlanStr.StatusCol="Status";
vlanStr.NativeCol="Native VLAN";
vlanStr.TaggedCol="Tagged VLANs";
vlanStr.DefaultLan="Default LAN (untagged)";

vlanStr.MatrixSect="Inter-VLAN Access";
vlanStr.MatrixHelp="Check a box to allow traffic from the row's network to the column's network. Every VLAN can always reach the internet regardless of this table; unchecked cells here just mean the two networks can't see each other directly. Leave everything unchecked to keep every VLAN fully isolated from the others.";
vlanStr.MatrixNeedsTwo="Add at least one VLAN to configure access between networks.";

vlanStr.PinholeSect="Exceptions";
vlanStr.PinholeHelp="Punch a hole through an otherwise-denied pair for one specific device, instead of opening up the whole network in the table above (for example, letting the Guest network print to one specific printer on the Default LAN).";
vlanStr.PinholeSrcCol="From";
vlanStr.PinholeIpCol="Destination IP";
vlanStr.PinholePortCol="Destination Port";
vlanStr.PinholeProtoCol="Protocol";
vlanStr.PinholeDescCol="Description";
vlanStr.AnyPort="any";

vlanStr.IdReservedErr="ERROR: VLAN ID 1 is reserved for the Default LAN.";
vlanStr.IdDupErr="ERROR: That VLAN ID is already in use.";
vlanStr.IdRangeErr="ERROR: VLAN ID must be a number between 2 and 4094.";
vlanStr.SubnetFormatErr="ERROR: Subnet must be in the form 192.168.20.0/24.";
vlanStr.SubnetPrefixErr="ERROR: Subnet must be between /8 and /30 and large enough for at least one device.";
vlanStr.SubnetOverlapErr="ERROR: That subnet overlaps with the Default LAN or another VLAN.";
vlanStr.NoTrustedPortErr="ERROR: At least one port must remain on the Default LAN. Assigning every port away from the Default LAN could lock you out of the router.";
vlanStr.PinholeIpErr="ERROR: Destination must be a valid IP address.";
vlanStr.PinholeIpUnknownErr="ERROR: That IP address is not within the Default LAN or any defined VLAN's subnet.";
vlanStr.PinholeSameZoneErr="ERROR: Source and destination are the same network; that traffic is already allowed.";
vlanStr.PinholePortErr="ERROR: Destination Port must be a number, or left blank for any port.";
vlanStr.PinholeDupErr="ERROR: That exception already exists.";
