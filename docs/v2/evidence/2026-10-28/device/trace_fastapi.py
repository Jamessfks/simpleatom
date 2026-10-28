"""Send device=cuda through the real FastAPI app (in-process) under a given profile."""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.getcwd(), "mace-api"))
from fastapi.testclient import TestClient
import main
c = TestClient(main.app)
print("profile", os.environ.get("SIMPLEATOM_PROFILE"))
print("GET /capabilities", json.dumps(c.get("/capabilities").json())[:400])
print("GET /health", c.get("/health").json())
params = json.dumps({"calculationType": "single-point", "modelType": "MACE-OFF", "modelSize": "small", "device": "cuda"})
xyz = open("public/demo/ethanol.xyz", "rb").read()
def show(tag, d):
    r = d.get("result", d)
    m = r.get("provenance") or {}
    print(tag, r.get("status"), "params.device=", (r.get("params") or {}).get("device"),
          "requestedDevice=", (r.get("params") or {}).get("requestedDevice"),
          "warnings=", r.get("warnings"), "manifest.runtime.device=", (m.get("runtime") or {}).get("device"),
          "timeTaken=", r.get("timeTaken"), "timing=", {k: v for k, v in r.items() if "tim" in k.lower()})
resp = c.post("/calculate", files={"files": ("ethanol.xyz", xyz)}, data={"params": params})
print("POST /calculate", resp.status_code); show("  /calculate", resp.json())
resp = c.post("/v1/jobs", files={"files": ("ethanol.xyz", xyz)}, data={"params": params})
print("POST /v1/jobs", resp.status_code, json.dumps(resp.json())[:300])
jid = resp.json().get("id") or resp.json().get("jobId")
for _ in range(120):
    j = c.get(f"/v1/jobs/{jid}").json()
    if j.get("status") in ("succeeded", "failed", "cancelled", "done", "error", "complete", "completed"):
        break
    time.sleep(0.5)
print("job keys", sorted(j.keys()), "status", j.get("status"))
show("  /v1/jobs", j)
