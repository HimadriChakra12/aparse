/* build.c -- concatenates src/ modules in dependency order into
 * dist/aparse.user.js, using build.h for all the generic plumbing.
 *
 * Usage: run from the project root as `./tools/build` (see Makefile).
 */
#include "build.h"

#define NAME        "Apars Classroom HLS Saver"
#define NAMESPACE   "apars-aparse"
#define DESCRIPTION "Download 720p HLS stream (forced level select + ffmpeg.wasm remux)"

listout(MATCH,
    "https://*.aparsclassroom.com/*",
    "https://iframe.mediadelivery.net/*",
    "https://*.mediadelivery.net/*");

listout(GRANT,
    "unsafeWindow",
    "GM_download");

/* Dependency order matters: namespace first, then core utilities before
 * anything that calls them, then ui, then entry.js last since it invokes
 * everything above. */
listout(ORDER,
    "src/namespace.js",
    "src/core/util.js",
    "src/core/frame-bridge.js",
    "src/core/network-hooks.js",
    "src/core/hls-instance.js",
    "src/core/playlist-resolver.js",
    "src/core/hls-crypto.js",
    "src/core/segments.js",
    "src/core/mux.js",
    "src/core/muxdownloader.js",
    "src/ui/button.js",
    "src/core/entry.js");

int main(void) {
    build_t b;
    build_init(&b, NULL, "__HLS_SAVER_VERSION__"); /* NULL -> tools/VERSION */

    build_meta_t meta = {
        .name = NAME,
        .namespace_ = NAMESPACE,
        .description = DESCRIPTION,
        .match = MATCH, .match_count = MATCH_COUNT,
        .grant = GRANT, .grant_count = GRANT_COUNT,
        .run_at = "document-start",
    };
    build_userscript_header(&b, &meta);

    build_add_all(&b, ORDER, ORDER_COUNT, "src/");
    build_finish(&b, "dist/aparse.user.js");
    return 0;
}
