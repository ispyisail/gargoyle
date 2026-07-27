include $(TOPDIR)/rules.mk

PKG_NAME:=plugin_gargoyle_doh
PKG_VERSION:=$(GARGOYLE_VERSION)
ifeq ($(GARGOYLE_VERSION),)
     PKG_VERSION:=1.0.0
endif
PKG_RELEASE:=1


PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

define Package/plugin-gargoyle-doh
	SECTION:=admin
	CATEGORY:=Administration
	SUBMENU:=Gargoyle Web Interface
	TITLE:=DNS over HTTPS
	DEPENDS:=+https-dns-proxy-gargoyle +gargoyle
	MAINTAINER:=Michael Gray
	PKGARCH:=all
endef

define Package/plugin-gargoyle-doh/description
	DNS over HTTPS support for Gargoyle
endef

define Build/Prepare
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/plugin-gargoyle-doh/install
	$(INSTALL_DIR) $(1)
	$(CP) ./files/* $(1)/
endef

define Package/plugin-gargoyle-doh/postinst
	if [ -z "$${IPKG_INSTROOT}" ] ; then
		# Advisory only -- DoH plus its curl/libcares/libev/ca-bundle deps run
		# ~900K installed. Below this floor it's the admin's informed call,
		# not a hard block.
		flash_kb=$$(df -k /overlay 2>/dev/null | awk 'NR==2{print $$2}')
		mem_kb=$$(awk '/^MemTotal:/{print $$2}' /proc/meminfo 2>/dev/null)
		if [ -n "$$flash_kb" ] && [ "$$flash_kb" -lt 16384 ] ; then
			echo "plugin-gargoyle-doh: warning: this device's writable flash (~$${flash_kb}KB) is below the ~16MB DoH is tested against; the proxy and its TLS/HTTP dependencies use significant space." >&2
			logger -t plugin-gargoyle-doh "low flash (~$${flash_kb}KB) for DoH -- proceeding, informed choice"
		fi
		if [ -n "$$mem_kb" ] && [ "$$mem_kb" -lt 65536 ] ; then
			echo "plugin-gargoyle-doh: warning: this device's RAM (~$${mem_kb}KB) is below the ~64MB DoH is tested against." >&2
			logger -t plugin-gargoyle-doh "low RAM (~$${mem_kb}KB) for DoH -- proceeding, informed choice"
		fi

		menu_name="DNS over HTTPS"
		[ -n `which i18n` ] && {
			mn=$$(i18n-menu gargoyle.display.connection_doh)
			if [ -n "$$mn" ] ; then
				menu_name="$$mn"
			fi
		}
		uci set gargoyle.display.connection_doh="$$menu_name"
		uci set gargoyle.scripts.connection_doh="doh.sh"
		uci set gargoyle.connection.doh="215"
		uci commit
	fi
endef

define Package/plugin-gargoyle-doh/postrm
	if [ -z "$${IPKG_INSTROOT}" ] ; then 
		uci del gargoyle.display.connection_doh
		uci del gargoyle.scripts.connection_doh
		uci del gargoyle.connection.doh
		uci commit
	fi
endef

$(eval $(call BuildPackage,plugin-gargoyle-doh))
