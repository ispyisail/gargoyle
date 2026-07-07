# 
# Copyright (C) 2006 OpenWrt.org
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#
# $Id: Makefile 9907 2007-12-25 01:59:55Z nbd $

include $(TOPDIR)/rules.mk

PKG_NAME:=libbbtargz
PKG_VERSION:=$(GARGOYLE_VERSION)
ifeq ($(GARGOYLE_VERSION),)
     PKG_VERSION:=1.0.0
endif
PKG_RELEASE:=1

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

# unarchive.c calls seek_by_read() with no prior prototype (2007-era
# code, extracted from busybox with the declaration left behind).
# GCC <= 13 only warned; GCC 14 (first used by this toolchain as of
# the OpenWrt 25.12 bump) makes implicit function declarations a hard
# error by default, which breaks this package's build outright. Same
# root cause and same fix already validated for the host-side gapk
# dev-loop build (tests/gapk/build-host.sh in gargoyle-tools) --
# applying the identical, already-proven workaround here rather than
# attempting to source/restore the real prototype from upstream
# busybox for 2007-era code neither of us has full context on.
TARGET_CFLAGS += -std=gnu89 -Wno-implicit-function-declaration

define Package/libbbtargz
	SECTION:=libs
	CATEGORY:=Libraries
	TITLE:=TAR/GZ Utils Library Taken From Busybox
	URL:=http://www.gargoyle-router.com
	MAINTAINER:=Eric Bishop <eric@gargoyle-router.com>
endef


define Package/libbbtargz/description
	TAR/GZ Utils Library Taken From Busybox
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)
endef


define Build/Configure
endef

define Build/InstallDev
	mkdir -p $(STAGING_DIR)/usr/include/
	$(CP) $(PKG_BUILD_DIR)/*.h $(STAGING_DIR)/usr/include/

	mkdir -p $(STAGING_DIR)/usr/lib
	$(CP) $(PKG_BUILD_DIR)/*.so* $(STAGING_DIR)/usr/lib/

endef

define Package/libbbtargz/install
	$(INSTALL_DIR) $(1)/usr/lib
	$(CP) $(PKG_BUILD_DIR)/*.so* $(1)/usr/lib/
endef

$(eval $(call BuildPackage,libbbtargz))
