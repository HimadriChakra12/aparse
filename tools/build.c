/* build.c -- concatenates src/ modules in dependency order into
 * dist/aparse.user.js, prepends the userscript header, and substitutes
 * __HLS_SAVER_VERSION__ with the contents of tools/VERSION.
 *
 * Replaces tools/build.js (Node) so the whole project has no JS runtime
 * dependency for building -- same reasoning as avroc.c in Avroscript.
 *
 * Usage: run from the project root as `./tools/build` (see Makefile).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_FILE 1048576      /* 1 MiB per source module, generous */
#define MAX_OUTPUT (8 * 1024 * 1024)

/* Dependency order matters: namespace first, then core utilities before
 * anything that calls them, then ui, then entry.js last since it invokes
 * everything above. Mirrors the ORDER array in the old build.js. */
static const char *ORDER[] = {
    "src/namespace.js",
    "src/core/util.js",
    "src/core/frame-bridge.js",
    "src/core/network-hooks.js",
    "src/core/hls-instance.js",
    "src/core/playlist-resolver.js",
    "src/core/segments.js",
    "src/core/remux.js",
    "src/core/downloader.js",
    "src/ui/button.js",
    "src/core/entry.js",
};
#define ORDER_COUNT (sizeof(ORDER) / sizeof(ORDER[0]))

static const char *HEADER_TEMPLATE =
    "// ==UserScript==\n"
    "// @name         Apars Classroom HLS Saver\n"
    "// @namespace    apars-aparse\n"
    "// @version      %s\n"
    "// @description  Download 720p HLS stream (forced level select + ffmpeg.wasm remux)\n"
    "// @match        https://*.aparsclassroom.com/*\n"
    "// @match        https://iframe.mediadelivery.net/*\n"
    "// @match        https://*.mediadelivery.net/*\n"
    "// @grant        unsafeWindow\n"
    "// @run-at       document-start\n"
    "// ==/UserScript==\n\n";

static char *read_file(const char *path, long *out_len) {
    FILE *f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "build: missing source file: %s\n", path);
        exit(1);
    }
    char *buf = malloc(MAX_FILE);
    if (!buf) { perror("malloc"); exit(1); }
    long n = fread(buf, 1, MAX_FILE - 1, f);
    fclose(f);
    buf[n] = '\0';
    *out_len = n;
    return buf;
}

static char *read_version(const char *path) {
    long n;
    char *v = read_file(path, &n);
    /* trim trailing newline/whitespace */
    while (n > 0 && (v[n-1] == '\n' || v[n-1] == '\r' || v[n-1] == ' ')) {
        v[--n] = '\0';
    }
    return v;
}

/* Appends src into dst (which must have room), replacing every occurrence
 * of __HLS_SAVER_VERSION__ with version. Returns new length. */
static size_t append_with_substitution(char *dst, size_t dst_len,
                                        const char *src, const char *version) {
    const char *needle = "__HLS_SAVER_VERSION__";
    size_t needle_len = strlen(needle);
    size_t version_len = strlen(version);
    const char *p = src;

    while (*p) {
        const char *match = strstr(p, needle);
        if (!match) {
            size_t rest = strlen(p);
            memcpy(dst + dst_len, p, rest);
            dst_len += rest;
            break;
        }
        size_t chunk = (size_t)(match - p);
        memcpy(dst + dst_len, p, chunk);
        dst_len += chunk;
        memcpy(dst + dst_len, version, version_len);
        dst_len += version_len;
        p = match + needle_len;
    }
    return dst_len;
}

int main(void) {
    char *version = read_version("tools/VERSION");

    char *out = malloc(MAX_OUTPUT);
    if (!out) { perror("malloc"); exit(1); }
    size_t out_len = 0;

    char header[1024];
    int hlen = snprintf(header, sizeof(header), HEADER_TEMPLATE, version);
    memcpy(out, header, (size_t)hlen);
    out_len = (size_t)hlen;

    for (size_t i = 0; i < ORDER_COUNT; i++) {
        long len;
        char *content = read_file(ORDER[i], &len);

        char marker[256];
        int mlen = snprintf(marker, sizeof(marker), "// ---- %s ----\n", ORDER[i] + 4 /* strip "src/" */);
        memcpy(out + out_len, marker, (size_t)mlen);
        out_len += (size_t)mlen;

        out_len = append_with_substitution(out, out_len, content, version);
        out[out_len++] = '\n';

        free(content);
    }

    if (system("mkdir -p dist") != 0) {
        fprintf(stderr, "build: failed to create dist/\n");
        exit(1);
    }

    FILE *f = fopen("dist/aparse.user.js", "wb");
    if (!f) { perror("fopen dist/aparse.user.js"); exit(1); }
    fwrite(out, 1, out_len, f);
    fclose(f);

    printf("Built dist/aparse.user.js (%zu bytes, %zu modules, v%s)\n",
           out_len, ORDER_COUNT, version);

    free(out);
    free(version);
    return 0;
}
