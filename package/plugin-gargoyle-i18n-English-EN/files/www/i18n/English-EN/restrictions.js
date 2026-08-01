/*
 * UTF-8 (with BOM) English-EN text strings for restrictions.sh html elements
 */

restStr.mRestrict="Restrictions";
restStr.ARSect="Access Restrictions";
restStr.NRRule="New Restriction Rule";
restStr.ANRule="Add New Rule";
restStr.CRestr="Current Restrictions";
restStr.EWSect="Exceptions (White List)";
restStr.NExcp="New Exception";
restStr.CExcp="Current Exceptions";

restStr.ERSect="Edit Restriction Rule";
restStr.EESect="Edit Exception Rule";

//templates
restStr.RDesc="Rule Description";
restStr.RAppl="Rule Applies To";
restStr.AHsts="All Hosts";
restStr.EHsts="All Hosts Except";
restStr.OHsts="Only The Following Hosts";
restStr.DevGroup="Device Group";
restStr.HstAddr="Specify an IP, IP range or MAC address";
restStr.HstAddrAny="\"Both\" matches a device by its MAC address only. To restrict a specific IPv4 or IPv6 address, choose that family above.";
restStr.IPFamBoth="Both (MAC only)";
restStr.Schd="Schedule";
restStr.ADay="All Day";
restStr.EDay="Every Day";
restStr.DSchd="Schedule Repeats Daily";
restStr.WSchd="Schedule Repeats Weekly";
restStr.DActv="Days Active";
restStr.HActv="Hours Active";
restStr.DHActv="Days And Hours Active";
restStr.Sample="e.g. Mon 00:30 - Thu 13:15, Fri 14:00 - Fri 15:00";
restStr.SSample="e.g.";
restStr.RRsrc="Restricted Resources";
restStr.NetAcc="All Network Access";
restStr.RemIP="Remote IP(s)";
restStr.RemPrt="Remote Port(s)";
restStr.LclPrt="Local Port(s)";
restStr.TrProto="Transport Protocol";
restStr.ApProto="Application Protocol";
restStr.WebURL="Website URL(s)";
restStr.BlAll="Block All";
restStr.BlOny="Block Only";
restStr.BlExc="Block All Except";
restStr.BlTCP="Block TCP";
restStr.BlUDP="Block UDP";
restStr.FUExt="Full URL matches exactly";
restStr.FUCnt="Full URL contains";
restStr.FURgx="Full URL matches Regex";
restStr.DmExt="Domain matches exactly";
restStr.DmCon="Domain contains";
restStr.DmRgx="Domain matches Regex";
restStr.ESect="Exception Description";
restStr.EAppl="Exception Applies To";
restStr.PRsrc="Permitted Resources";
restStr.PmAll="Permit All";
restStr.PmOny="Permit Only";
restStr.PmExc="Permit All Except";
restStr.PmTCP="Permit TCP";
restStr.PmUDP="Permit UDP";

//javascript
restStr.ARErr="Could not add rule.";
restStr.IAErr="ERROR: Invalid Address";
restStr.UPrt="URL Part";
restStr.MTyp="Match Type";
restStr.MTExp="Match Text / Expression";
restStr.UMZErr="ERROR: URL match length must be greater than zero";
restStr.UChErr="ERROR: URL match cannot contain quote or newline characters";

//timed re-enable (disable a rule, it re-enables itself after a set time)
restStr.Re30M="30 min";
restStr.Re1H="1 hr";
restStr.Re4H="4 hr";
restStr.ReTom="Until Tomorrow";
restStr.ReCustLbl="Custom:";
restStr.ReMinUnit="minutes";
restStr.ReHrUnit="hours";
restStr.ReSetBtn="Set";
restStr.ReCancel="Cancel";
restStr.ReChange="Change";
restStr.RePendRel30="Will re-enable in 30 minutes";
restStr.RePendRel1H="Will re-enable in 1 hour";
restStr.RePendRel4H="Will re-enable in 4 hours";
restStr.RePendRelTom="Will re-enable tomorrow at midnight";
restStr.RePendRelCust="Will re-enable after Save";
restStr.RePendAbsPfx="Disabled until";
restStr.ReDurErr="ERROR: custom duration must be a whole number of minutes or hours, greater than zero";

restStr.FTWBtn="Quick Setup: Family Time Controls";
restStr.FTWIntro="Set a schedule that blocks internet access for a device or group, without needing to understand firewall rules yourself.";
restStr.FTWTitle="Family Time Controls";
restStr.FTWNoDevices="Nothing to pick from yet: no devices are set up, and nothing is currently connected. Go to Connection > DHCP and add a device in the Devices section, then come back here.";
restStr.FTWCreateGroupDesc="Who is this for? Pick a device and give its group a name (for example \"kids\").";
restStr.FTWDeviceLabel="Device";
restStr.FTWGroupNameLabel="Group name";
restStr.FTWNewDeviceTag="(new)";
restStr.FTWNoDeviceSelected="Pick a device.";
restStr.FTWBadGroupName="Enter a group name using only letters, numbers, hyphens, and underscores.";
restStr.FTWStep1Desc="Who is this for? Pick one or more device groups.";
restStr.FTWNoGroupSelected="Pick at least one device group.";
restStr.FTWNext="Next";
restStr.FTWStep2Desc="When should internet access be blocked? This blocks all internet access during the times you pick.";
restStr.FTWFrom="From";
restStr.FTWTo="To";
restStr.FTWAM="AM";
restStr.FTWPM="PM";
restStr.FTWTimeFormatHint="Use 24-hour time (e.g. 21:00 for 9:00 PM, 07:00 for 7:00 AM) -- a preview appears next to each field as you type.";
restStr.FTWTimezoneHint="Times use the router's own time zone, not this device's -- if you're setting this up while traveling, use the time where the router (and the family) actually is.";
restStr.FTWDays="On these days";
restStr.FTWBadTimes="Enter a valid from and to time.";
restStr.FTWNoDaySelected="Pick at least one day.";
restStr.FTWCreate="Create";
restStr.FTWDone="Done. The schedule is saved and active.";
restStr.FTWOverrideHint="Need to give more time right now? Find this rule in the Current Restrictions list below and use its 30 min / 1 hr / 4 hr / Until Tomorrow buttons.";
