
#include "gpkg.h"
#include "apkexec.h"


/* Verify a freshly-downloaded package list against a usign signature fetched
 * from the same feed base. Returns 1 if the list is trusted (either because
 * signature checking is off, or because a Packages.sig validated against a
 * key in conf->signature_keys_dir), 0 if checking is on and the list is
 * unsigned or fails to verify -- fail-closed, so a caller treats 0 as a
 * download failure and does not install the list.
 *
 * usign signs the UNCOMPRESSED Packages (the same convention OpenWrt's own
 * feeds use), so for a src/gz feed the gzip'd list is decompressed to a temp
 * file before verifying. Verification shells out to usign (present in the
 * image), matching how the on-router OTA client verifies images -- one usign,
 * one trusted-key store (/etc/opkg/keys), for both. */
static int feed_signature_verified(opkg_conf* conf, const char* list_tmp_path, const char* base_url, int is_gzip, const char* src_id)
{
	if(!conf->check_signature)
	{
		return 1;
	}

	int ok = 0;
	char* sig_url    = dynamic_strcat(2, base_url, is_gzip ? "/Packages.sig" : "Packages.sig");
	char* sig_path   = dynamic_strcat(2, list_tmp_path, ".sig");
	char* plain_path = NULL;

	FILE* sig_file = fopen(sig_path, "w");
	int sig_err = 1;
	if(sig_file != NULL)
	{
		sig_err = write_url_to_stream(sig_url, "gpkg", EW_UNSPEC, NULL, sig_file, NULL);
		fclose(sig_file);
	}

	if(sig_err)
	{
		fprintf(stderr, "ERROR: no signature for %s (Packages.sig missing) -- refusing an unsigned package list because check_signature is on\n", src_id);
		goto cleanup;
	}

	const char* verify_msg = list_tmp_path;
	if(is_gzip)
	{
		/* Decompress the downloaded gzip list to a temp so usign can
		 * verify over the same bytes that were signed. */
		plain_path = dynamic_strcat(2, list_tmp_path, ".plain");
		struct gzip_handle zh;
		FILE* in  = gzip_fdopen(&zh, (char*)list_tmp_path);
		FILE* out = (in != NULL) ? fopen(plain_path, "w") : NULL;
		int copy_ok = 0;
		if(in != NULL && out != NULL)
		{
			char buf[8192];
			size_t n;
			copy_ok = 1;
			while((n = fread(buf, 1, sizeof(buf), in)) > 0)
			{
				if(fwrite(buf, 1, n, out) != n)
				{
					copy_ok = 0;
					break;
				}
			}
		}
		if(out != NULL) { fclose(out); }
		if(in  != NULL) { gzip_close(&zh); }
		if(!copy_ok)
		{
			fprintf(stderr, "ERROR: could not decompress the downloaded list for %s to verify its signature\n", src_id);
			goto cleanup;
		}
		verify_msg = plain_path;
	}

	const char* argv[] = { "usign", "-V", "-q", "-m", verify_msg, "-x", sig_path, "-P", conf->signature_keys_dir, NULL };
	if(xsystem(argv) == 0)
	{
		ok = 1;
	}
	else
	{
		fprintf(stderr, "ERROR: signature verification failed for %s -- no key in %s signed this package list\n", src_id, conf->signature_keys_dir);
	}

cleanup:
	unlink(sig_path);
	if(plain_path != NULL) { unlink(plain_path); free(plain_path); }
	free(sig_url);
	free(sig_path);
	return ok;
}


void update(opkg_conf* conf)
{
	/* GPKG_BACKEND=apk: no lists_dir download step exists to refresh --
	 * load_package_data_apk() (Phase 3) queries apk_query_json live on
	 * every load_all_package_data() call already, so there's nothing
	 * else for this subcommand to do beyond a thin passthrough to apk's
	 * own index-cache refresh for the main root (see
	 * docs/gapk-implementation-plan.md Phase 5 in gargoyle-tools). apk
	 * does its own signature verification, so conf->check_signature does
	 * not apply on this path. */
	if(gpkg_using_apk_backend())
	{
		if(!apk_update_mainroot(conf->apk_root, conf->apk_repository, conf->apk_keys_dir))
		{
			fprintf(stderr, "ERROR: apk update failed\n");
		}
		return;
	}

	mkdir_p(conf->lists_dir, S_IRWXU | S_IRGRP | S_IXGRP | S_IROTH | S_IXOTH );

	int is_gzip[2] = { 1, 0 };
	string_map* src_lists[2] = { conf->gzip_sources, conf->plain_sources };
	int src_list_index;
	for(src_list_index=0; src_list_index < 2 ; src_list_index++)
	{
		unsigned long num_keys;
		char** src_list = get_string_map_keys(src_lists[src_list_index], &num_keys);
		int src_index;
		for(src_index=0; src_index < num_keys; src_index++)
		{
			char* src_id = src_list[src_index];
			char* src_base = (char*)get_string_map_element(src_lists[src_list_index], src_id);
			char* src_url = dynamic_strcat(2, src_base, (is_gzip[src_list_index] ? "/Packages.gz" : "Packages"));
			char* package_file_path = dynamic_strcat(3,  conf->lists_dir, "/", src_id);
			char* package_tmp_file_path = dynamic_strcat(2, package_file_path, ".download.gpkg.tmp");



			FILE* package_tmp_file = fopen(package_tmp_file_path, "w");
			int read_err = 1;

			if(package_tmp_file != NULL)
			{
				printf("Downloading package list for %s source...\n", src_id);
				read_err = write_url_to_stream(src_url, "gpkg", EW_UNSPEC, NULL, package_tmp_file, NULL);
				fclose(package_tmp_file);
			}

			/* A downloaded-but-unverified list must never be installed:
			 * treat a signature failure exactly like a download failure. */
			int verify_failed = 0;
			if(!read_err)
			{
				if(!feed_signature_verified(conf, package_tmp_file_path, src_base, is_gzip[src_list_index], src_id))
				{
					verify_failed = 1;
				}
			}

			if(!read_err && !verify_failed)
			{
				rm_r(package_file_path);
				rename(package_tmp_file_path, package_file_path);
				printf("Package list for %s downloaded successfully.\n\n", src_id);
			}
			else
			{
				rm_r(package_tmp_file_path);
				if(verify_failed)
				{
					/* the specific reason was already printed to stderr */
					printf("WARNING: Rejected package list for %s (signature check failed).\n\n", src_id);
				}
				else
				{
					printf("WARNING: Could not retrieve package list for %s.\n\n", src_id);
				}
			}

			free(src_url);
			free(package_tmp_file_path);
			free(package_file_path);
		}
		free_null_terminated_string_array(src_list);
	}
}
