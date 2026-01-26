# Supported Routers

Gargoyle firmware supports 400+ router models across 11 hardware target architectures. This document provides a comprehensive list of all supported devices.

## Table of Contents

- [ATH79 (Qualcomm Atheros)](#ath79-qualcomm-atheros)
- [BCM27xx (Raspberry Pi)](#bcm27xx-raspberry-pi)
- [BCM47xx (Broadcom Legacy)](#bcm47xx-broadcom-legacy)
- [IPQ40XX (Qualcomm Snapdragon WiFi)](#ipq40xx-qualcomm-snapdragon-wifi)
- [IPQ806X (Qualcomm Snapdragon High-End)](#ipq806x-qualcomm-snapdragon-high-end)
- [MediaTek ARM](#mediatek-arm)
- [MVEBU (Marvell ARM)](#mvebu-marvell-arm)
- [RAMIPS (Ralink/MediaTek MIPS)](#ramips-rlinkmediatek-mips)
- [Rockchip ARM](#rockchip-arm)
- [x86](#x86)

---

## ATH79 (Qualcomm Atheros)

Supports Qualcomm Atheros AR9xxx/QCA9xxx chipsets.

### Default Profile

| Manufacturer | Models |
|-------------|--------|
| Belkin | F9J1108 v2, F9K1115 v2 |
| Buffalo | WZR-600DHP, WZR-HP-AG300H, WZR-HP-G300NH-RB, WZR-HP-G300NH-S, WZR-HP-G450H |
| Comfast | CF-E375AC |
| Devolo | DLAN Pro 1200+ AC |
| D-Link | DIR-505, DIR-825 B1, DIR-825 C1, DIR-835 A1, DIR-842 C1/C2/C3, DIR-859 A1/A3, DIR-869 A1 |
| EnGenius | EAP300 v2 |
| GL.iNet | 6416, GL-AR150, GL-AR300M16, GL-AR750 |
| JJPlus | JA76PF2 |
| Netgear | WNDR3700, WNDR3700 v2, WNDR3800, WNDR3800CH, WNDRMAC v1/v2, WNR2200 (8M/16M) |
| Openmesh | MR1750 v1/v2, MR600 v1/v2, OM2P v2/v4, OM5P, OM5P AC v1/v2 |
| QXWLAN | E1700AC v2 (8M/16M), E600GAC v2 (8M/16M) |
| TP-Link | Archer A7 v5, Archer C25 v1, Archer C2 v3, Archer C58 v1, Archer C59 v1/v2, Archer C5 v1, Archer C60 v1/v2/v3, Archer C6 v2/v2 US, Archer C7 v1/v2/v4/v5, TL-WDR3600 v1, TL-WDR4300 v1, TL-WR1043ND v2/v3/v4, TL-WR1043N v5, TL-WR2543 v1, TL-WR810N v1, TL-WR841HP v2/v3, TL-WR842N v3, TL-WR902AC v1, TL-WR941HP v1 |
| Trendnet | TEW-673GRU, TEW-823DRU |
| Ubiquiti | Bullet AC, Bullet M XW, Nanostation M XW, Routerstation, Routerstation Pro, UniFi AP Outdoor Plus, UniFi AP Pro |
| Western Digital | MyNet N600, MyNet N750, MyNet WiFi Range Extender |

---

## BCM27xx (Raspberry Pi)

| Model | SoC |
|-------|-----|
| Raspberry Pi 1 | BCM2835 |
| Raspberry Pi 2 | BCM2709 |
| Raspberry Pi 3 | BCM2710 |
| Raspberry Pi 4 | BCM2711 |

---

## BCM47xx (Broadcom Legacy)

Generic Broadcom wireless router support for legacy BCM47xx chipsets.

---

## IPQ40XX (Qualcomm Snapdragon WiFi)

| Manufacturer | Models |
|-------------|--------|
| 8DEV | Jalapeno |
| ASUS | RT-AC42U, RT-AC58U |
| AVM | FRITZBox 4040, FRITZBox 7520, FRITZBox 7530 |
| GL.iNet | GL-A1300, GL-AP1300, GL-B1300, GL-B2200 |
| Linksys | EA6350v3, EA8300, MR8300 |
| Netgear | EX6100v2, EX6150v2, RBR50, RBS50, SRR60, SRS60 |
| Teltonika | RUTX50 |
| Zyxel | NBG6617 |

---

## IPQ806X (Qualcomm Snapdragon High-End)

| Manufacturer | Models |
|-------------|--------|
| ASRock | G10 |
| Linksys | EA7500 v1, EA8500 |
| Netgear | D7800, R7500v2, R7800, XR500 |
| TP-Link | C2600 |
| Zyxel | NBG6817 |

---

## MediaTek ARM

### Default Profile

| Manufacturer | Models |
|-------------|--------|
| BananaPi | BPI-R64 |
| Buffalo | WSR-2533DHP2 |
| Elecom | WRC-2533GENT |
| Linksys | E8450 |
| Netgear | WAX206 |
| Totolink | A8000RU |
| Ubiquiti | UniFi 6 LR v1/v2 |

### Filogic Profile (Newer MediaTek Chips)

| Manufacturer | Models |
|-------------|--------|
| Acer | Predator W6 |
| ASUS | TUF-AX4200, TUF-AX6000 |
| BananaPi | BPI-R3 |
| Cudy | WR-3000 v1 |
| GL.iNet | GL-MT3000, GL-MT6000 |
| Netgear | WAX220 |
| Xiaomi | Redmi Router AX6000 (Stock/UBootmod) |

---

## MVEBU (Marvell ARM)

| Manufacturer | Models |
|-------------|--------|
| CZNIC | Turris Omnia |
| Linksys | WRT1200AC, WRT1900AC v1/v2, WRT1900ACS, WRT3200ACM, WRT32x |

---

## RAMIPS (Ralink/MediaTek MIPS)

### Default Profile

| Manufacturer | Models |
|-------------|--------|
| Aigale | AI-BR100 |
| ALFA Network | AC1200RM |
| ASUS | RP-N53, RT-AC51U, RT-N14U |
| Buffalo | WHR-1166D, WHR-300HP2, WHR-600D, WMR-300 |
| D-Link | DCH-M225, DIR-810L, DWR-118 A1/A2, DWR-921 C1/C3, DWR-922 E2 |
| Dovado | Tiny AC |
| Elecom | WRH-300CR |
| GL.iNet | GL-MT300A, GL-MT300N, GL-MT750 |
| HiWiFi | HC5661, HC5761, HC5861 |
| Hnet | C108 |
| Kimax | U25AWF-H1 |
| Kingston | MLW221, MLWG2 |
| Lenovo | Newifi Y1, Newifi Y1S |
| Linksys | E1700 |
| Microduino | MicroWRT |
| Netgear | EX3700 |
| Nexx | WT3020 (8M) |
| OHYEAH | OY-0001 |
| Phicomm | K2G, PSG1208, PSG1218B |
| Planex | CS-QR10, DB-WRT01, MZK-750DHP, MZK-EX300NP, MZK-EX750NP |
| Ralink | MT7620A EVB, MT7620A MT7530 EVB, MT7620A MT7610E EVB, MT7620A V22SG EVB |
| Sanlinking | D240 |
| Sercomm | NA930 |
| TP-Link | Archer C2 v1, Archer C20 v1, Archer C20i, Archer C50 v1, TL-MR3020 v3, TL-MR3420 v5, TL-WA801ND v5, TL-WR802N v4, TL-WR840N v4, TL-WR841N v13, TL-WR842N v5, TL-WR902AC v3 |
| WRTNode | WRTNode |
| Xiaomi | MiWiFi Mini, Mi Router 4A 100M, Mi Router 4A 100M INTL, Mi Router 4C, MiWiFi Nano |
| Youku | YK-L1, YK-L1C |
| Yukai | BOCCO |
| ZBTLink | ZBT-APE522II, ZBT-CPE102, ZBT-WA05, ZBT-WE1026-5G 16M, ZBT-WE1026-H 32M, ZBT-WE2026, ZBT-WE826 (16M/32M) |
| ZTE | Q7 |

### MT7621 Profile

| Manufacturer | Models |
|-------------|--------|
| ASUS | RT-AC57U v1, RT-AC65P, RT-AC85P, RT-AX54, RT-AX53U, RT-N56U-B1 |
| Beeline | SmartBox Giga |
| Buffalo | WSR-1166DHP, WSR-2533DHPL, WSR-600DHP |
| D-Link | DIR-1960 A1, DIR-2640 A1, DIR-2660 A1, DIR-3060 A1, DIR-853 A1/A3/R1, DIR-860L B1, DIR-867 A1, DIR-878 A1/R1, DIR-882 A1/R1 |
| Edimax | RG21S, RA21S, RE23S |
| Elecom | WRC-1167GHBK2-S, WRC-1167GS2-B, WRC-1167GST2, WRC-1750GS, WRC-1750GST2, WRC-1750GSV, WRC-1900GST, WRC-2533GHBK-I, WRC-2533GS2, WRC-2533GST, WRC-2533GST2 |
| GL.iNet | GL-MT1300 |
| Linksys | E5600, E7350, EA6350 v4, EA7300 v1/v2, EA7500 v2, EA8100 v1/v2, RE6500, RE7000 |
| Mercusys | MR70X v1 |
| MikroTik | RouterBoard 750GR3 |
| Netgear | EX6150, R6220, R6260, R6350, R6700 v2, R6800, R6850, R6900 v2, R7200, R7450, WAC104, WAC124, WAX202, WNDR3700 v5 |
| TotoLink | A7000R, X5000R |
| TP-Link | Archer A6 v3, Archer AX23 v1, Archer C6 v3, Archer C6U v1, EAP235-Wall v1, EAP615-Wall v1, ER605 v2, RE500 v1, RE650 v1/v2 |
| Ubiquiti | EdgeRouter X, UniFi 6 Lite, UniFi NanoHD |
| Xiaomi | Mi Router 3G, Mi Router 3G v2, Mi Router 4A Gigabit, Mi Router AC2100, Redmi Router AC2100 |
| ZBTLink | ZBT-WE1326, ZBT-WE3526, ZBT-WG1602 16M, ZBT-WG2626, ZBT-WG3526 (16M/32M) |
| Zyxel | NWA50AX, NWA55AXE, WSM20 |

### MT76X8 Profile

| Manufacturer | Models |
|-------------|--------|
| GL.iNet | GL-MT300N v2 |
| Netgear | R6020, R6080, R6120 |
| TP-Link | Archer C20 v4/v5, Archer C50 v3/v4, TL-MR3020 v3, TL-MR3420 v5, TL-WA801ND v5, TL-WR802N v4, TL-WR840N v4, TL-WR841N v13, TL-WR842N v5, TL-WR902AC v3 |
| Xiaomi | Mi Router 4A 100M, Mi Router 4A 100M INTL, Mi Router 4C, MiWiFi Nano |

### RT305X Profile

| Manufacturer | Models |
|-------------|--------|
| Fon | Fonera 2.0N |

---

## Rockchip ARM

| Manufacturer | Models |
|-------------|--------|
| FriendlyARM | NanoPi R2S, NanoPi R4S |
| Pine64 | RockPro64 |
| Radxa | Rock Pi 4A |

---

## x86

### Generic x86
- PC/Generic x86 systems

### x86-64
- Generic x86-64 machines

### ALIX Profile
- ALIX board systems (Geode processors)

---

## Summary

| Target | Device Count |
|--------|-------------|
| ATH79 | 87+ |
| BCM27xx | 4 |
| BCM47xx | Generic |
| IPQ40XX | 22 |
| IPQ806X | 9 |
| MediaTek | 19 |
| MVEBU | 7 |
| RAMIPS | 173+ |
| Rockchip | 4 |
| x86 | 3 profiles |

**Total: 400+ supported devices from 40+ manufacturers**

---

## Source

Device support information is defined in the profile configuration files located at:
```
targets/<architecture>/profiles/<profile>/profile_images
```
