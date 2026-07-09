#
# Copyright (C) 2007-2016 OpenWrt.org
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=zip
PKG_REV:=30
PKG_VERSION:=3.0
PKG_RELEASE:=5

PKG_SOURCE:=zip$(PKG_REV).tar.gz
PKG_SOURCE_URL:=@SF/zip
PKG_HASH:=f0e8bb1f9b7eb0b01285495a2699df3a4b766784c1765a8f1aeedf63c0806369
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)/zip$(PKG_REV)

PKG_MAINTAINER:=Álvaro Fernández Rojas <noltari@gmail.com>
PKG_LICENSE:=BSD-4-Clause
PKG_LICENSE_FILES:=LICENSE

PKG_INSTALL:=1
PKG_BUILD_PARALLEL:=1

include $(INCLUDE_DIR)/package.mk

define Package/zip
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Archiver for .zip files
  URL:=http://infozip.sourceforge.net/Zip.html
  SUBMENU:=Compression
endef

define Package/zip/description
	This is InfoZIP's zip program. It produces files that are fully
	compatible with the popular PKZIP program; however, the command line
	options are not identical. In other words, the end result is the same,
	but the methods differ.
endef

# The stock "generic" target's unix/configure runs feature-detection
# probes that try to compile+link+run tiny test programs -- impossible
# under cross-compilation, so every probe silently assumes the worst
# and falls back to a batch of "-DNO_*"/"-DZMEM" defines that select
# zip's own bundled, K&R-style fallback implementations (of memset,
# mktime, etc, each guarded by a hand-written prototype in zip.h/
# timezone.c that assumes no real ANSI <string.h>/<time.h> exists).
# musl provides working, ANSI-conformant versions of every one of these
# (memset/memcpy/memcmp, rmdir, strchr/strrchr, rename, mktemp/mkstemp/
# mktime, errno, dirent, valloc), so every one of these defines is, and
# always has been, a false positive for this cross build -- GCC <= 13
# only warned about the resulting prototype conflicts/incomplete-type
# uses; GCC 14 (first used by this toolchain, 25.12) makes them hard
# errors. Split configure and build into two steps so the generated
# flags file can have the whole false-positive batch stripped in
# between, instead of patching zip's own 2008-era unix/Makefile or
# unix/configure, or whack-a-moling one -DNO_* at a time as each newly
# becomes a hard error.
define Build/Compile
	$(MAKE) -C $(PKG_BUILD_DIR) \
		-f unix/Makefile flags \
		CC="$(TARGET_CC) $(TARGET_CFLAGS) -O $(TARGET_CPPFLAGS) -I. -DUNIX $(TARGET_LDFLAGS)" \
		IZ_BZIP2="no"
	sed -i -E 's/-D(NO_[A-Z0-9_]+|ZMEM)//g' $(PKG_BUILD_DIR)/flags
	cd $(PKG_BUILD_DIR); eval $(MAKE) -f unix/Makefile zips `cat $(PKG_BUILD_DIR)/flags` \
		prefix="$(PKG_INSTALL_DIR)/usr" \
		IZ_BZIP2="no"
endef

define Build/Install
	$(MAKE) -C $(PKG_BUILD_DIR) \
		-f unix/Makefile install \
		prefix="$(PKG_INSTALL_DIR)/usr"
endef

define Package/zip/install
	$(INSTALL_DIR) $(1)/usr/bin/
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/usr/bin/* $(1)/usr/bin/
endef

$(eval $(call BuildPackage,zip))
