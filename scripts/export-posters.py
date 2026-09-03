#!/usr/bin/env python3
"""
Export every poster in a Seek/Floppy library as a print-ready image file.

Floppy stores each poster as a URL, not an uploaded file, so this walks the
library over the API, upsizes TMDB posters from Floppy's w500 to `original`
(full resolution), leaves already-high-res custom posters alone, and drops the
lot into a folder plus a .zip you can hand to someone.

Posters are split into two subfolders that match how you think about them in
Floppy: `default/` for TMDB art and `posterdb/` for the custom ones you set
yourself (anything not on image.tmdb.org). A manifest.csv lists every file.

Stdlib only — no pip installs. Runs anywhere with Python 3.8+.

    FLOPPY_URL=http://10.0.1.14:8007 FLOPPY_TOKEN=xxxx python3 export-posters.py

Options:
    --out DIR        where to write (default: ./seek-posters)
    --types a,b      media types to export (default: tv,movie,anime)
    --size SIZE      TMDB size token (default: original; try w780 for smaller)
"""
import argparse
import csv
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile

PLACEHOLDER_HOSTS = {"www.themoviedb.org", "themoviedb.org"}
TMDB_HOST = "image.tmdb.org"
TMDB_SIZE_RE = re.compile(r"/t/p/(w\d+|h\d+|original)/")


def api(base, token, path, params=None):
    url = base.rstrip("/") + path
    if params:
        url += "?" + urllib.parse.urlencode(params, doseq=True)
    req = urllib.request.Request(url, headers={"Authorization": f"Token {token}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def library(base, token, media_type):
    """Yield every tracked item of one media type, paging past Floppy's limit."""
    offset, limit = 0, 100
    while True:
        try:
            page = api(base, token, f"/api/v1/media/{media_type}/",
                       {"status": "all", "progress": "all", "limit": limit, "offset": offset})
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return  # this instance doesn't have that media type
            raise
        results = page.get("results") or []
        for row in results:
            yield row.get("item") or {}
        total = (page.get("pagination") or {}).get("total", 0)
        offset += limit
        if offset >= total or not results:
            return


def full_res(url, size):
    """Rewrite a TMDB thumbnail URL to full resolution; leave others as-is."""
    parts = urllib.parse.urlparse(url)
    if parts.netloc == TMDB_HOST and TMDB_SIZE_RE.search(parts.path):
        return url.replace(TMDB_SIZE_RE.search(parts.path).group(0), f"/t/p/{size}/")
    return url


def is_real_poster(url):
    if not url or not url.startswith("http"):
        return False
    host = urllib.parse.urlparse(url).netloc
    if host in PLACEHOLDER_HOSTS or url.lower().endswith(".svg"):
        return False
    return True


def safe_name(title, year):
    base = f"{title} ({year})" if year else title
    base = re.sub(r'[<>:"/\\|?*]', "", base).strip().rstrip(".")
    return base or "Untitled"


def ext_of(url):
    path = urllib.parse.urlparse(url).path
    m = re.search(r"\.(jpe?g|png|webp)$", path, re.I)
    return "." + m.group(1).lower().replace("jpeg", "jpg") if m else ".jpg"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="seek-posters")
    ap.add_argument("--types", default="tv,movie,anime")
    ap.add_argument("--size", default="original")
    args = ap.parse_args()

    base = os.environ.get("FLOPPY_URL")
    token = os.environ.get("FLOPPY_TOKEN")
    if not base or not token:
        sys.exit("Set FLOPPY_URL and FLOPPY_TOKEN environment variables first.")

    os.makedirs(os.path.join(args.out, "default"), exist_ok=True)
    os.makedirs(os.path.join(args.out, "posterdb"), exist_ok=True)

    manifest, used, saved, skipped, failed = [], set(), 0, 0, 0

    for media_type in [t.strip() for t in args.types.split(",") if t.strip()]:
        for item in library(base, token, media_type):
            title = item.get("title") or "Untitled"
            url = item.get("image") or ""
            if not is_real_poster(url):
                skipped += 1
                continue

            host = urllib.parse.urlparse(url).netloc
            folder = "default" if host == TMDB_HOST else "posterdb"
            fetch_url = full_res(url, args.size)

            name = safe_name(title, item.get("release_datetime", "")[:4] if item.get("release_datetime") else "")
            fname = name + ext_of(fetch_url)
            n = 2
            while (folder, fname.lower()) in used:
                fname = f"{name} ({n}){ext_of(fetch_url)}"
                n += 1
            used.add((folder, fname.lower()))

            dest = os.path.join(args.out, folder, fname)
            try:
                with urllib.request.urlopen(fetch_url, timeout=60) as r:
                    data = r.read()
                with open(dest, "wb") as f:
                    f.write(data)
                saved += 1
                manifest.append([title, media_type, folder, fname, len(data), fetch_url])
                print(f"  {folder:8}  {fname}")
            except Exception as e:
                failed += 1
                print(f"  FAILED   {title}: {e}", file=sys.stderr)

    with open(os.path.join(args.out, "manifest.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["title", "type", "folder", "filename", "bytes", "source_url"])
        w.writerows(manifest)

    zip_path = args.out.rstrip("/") + ".zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(args.out):
            for fn in files:
                p = os.path.join(root, fn)
                z.write(p, os.path.relpath(p, os.path.dirname(args.out) or "."))

    default_n = sum(1 for m in manifest if m[2] == "default")
    custom_n = sum(1 for m in manifest if m[2] == "posterdb")
    print(f"\nSaved {saved} posters — {default_n} default, {custom_n} posterdb."
          f"  Skipped {skipped} without art, {failed} failed.")
    print(f"Folder: {args.out}/   Zip: {zip_path}")


if __name__ == "__main__":
    main()
