all: gpkg

# json.o: the apk-JSON reader added for the gapk re-backend (see
# docs/gapk-implementation-plan.md in gargoyle-tools). Linked in starting
# now even though nothing calls it yet -- apkexec.o (Phase 2) and the
# GPKG_BACKEND=apk switch in gpkg.c (Phase 3+) are what will actually
# invoke it. Dead-linked object code carries no functional risk to the
# existing opkg-format backend.
gpkg: gpkg.o conf.o load.o xsystem.o update.o remove.o install.o upgrade.o list.o info.o alternatives.o json.o
	$(CC) $(CFLAGS) $(LDFLAGS) $^ -o $@ -lericstools -lbbtargz -lewget

%.o: %.c
	$(CC) $(CFLAGS) -c  $^ -o $@ 
clean:
	rm -rf *.o *~ .*sw* gpkg
