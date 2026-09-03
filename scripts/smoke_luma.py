"""One real Luma image_edit on HG-002, two ways, to de-risk the design before any UI.

  A) source.url  -> can Luma fetch the customer's photo host itself? (it 403s plain clients)
  B) source.data -> our server fetches with a browser UA and sends base64 (the fallback)

Costs about $0.09 total. Outputs go to OUT_DIR (default: ./scratch, gitignored), never the repo.
Secrets: reads LUMA_AGENTS_API_KEY from the environment or .env.local; never prints it.
"""
import base64, json, os, sys, time, urllib.request, urllib.error, concurrent.futures as cf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.environ.get("OUT_DIR", os.path.join(ROOT, "scratch"))
PHOTO = "https://take-home-service.lumalabs-ext.workers.dev/assets/fde/hg-002.jpg"
PROMPT = ("Place this exact sage green stoneware mug on a morning kitchen counter, with steam "
          "rising from the mug and warm early sunlight. Keep the mug identical in shape, "
          "color, glaze, handle and proportions. Photorealistic product photography.")
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36"
API = "https://agents.lumalabs.ai/v1"


def load_key():
    key = os.environ.get("LUMA_AGENTS_API_KEY")
    if not key:
        with open(os.path.join(ROOT, ".env.local"), encoding="utf-8") as f:
            for line in f:
                if line.startswith("LUMA_AGENTS_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"')
    if not key:
        sys.exit("LUMA_AGENTS_API_KEY not set")
    return key


def http(method, url, key=None, body=None, ua=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body else None)
    if key: req.add_header("Authorization", f"Bearer {key}")
    if body: req.add_header("Content-Type", "application/json")
    if ua: req.add_header("User-Agent", ua)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def run(label, key, source):
    t0 = time.time()
    code, raw = http("POST", f"{API}/generations", key, {"type": "image_edit", "prompt": PROMPT, "source": source})
    if code >= 300:
        return label, f"submit HTTP {code}: {raw[:300]!r}"
    gen = json.loads(raw)
    gid = gen["id"]
    while gen.get("state") not in ("completed", "failed"):
        time.sleep(3)
        code, raw = http("GET", f"{API}/generations/{gid}", key)
        gen = json.loads(raw)
    dt = time.time() - t0
    if gen["state"] == "failed":
        return label, f"failed after {dt:.0f}s: {gen.get('failure_code')} {gen.get('failure_reason')}"
    url = gen["output"][0]["url"]
    code, img = http("GET", url)
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"hg-002-{label}.png")
    open(path, "wb").write(img)
    return label, f"completed in {dt:.0f}s, {len(img)//1024} KB -> {path}  (model={gen.get('model')})"


def main():
    key = load_key()
    code, photo = http("GET", PHOTO, ua=BROWSER_UA)
    print(f"photo fetch with browser UA: HTTP {code}, {len(photo)//1024} KB")
    if code != 200:
        sys.exit("cannot fetch source photo even with browser UA; stop here")
    jobs = {
        "A-url": {"url": PHOTO},
        "B-data": {"data": base64.b64encode(photo).decode(), "media_type": "image/jpeg"},
    }
    with cf.ThreadPoolExecutor(2) as ex:
        for label, result in ex.map(lambda kv: run(kv[0], key, kv[1]), jobs.items()):
            print(f"{label}: {result}")


if __name__ == "__main__":
    main()
