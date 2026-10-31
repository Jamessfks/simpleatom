# Install and run locally

Requirements: Node ≥ 20.9 (24 recommended, see `.nvmrc`), Python 3.11, about
2 GB of disk for PyTorch and models.

```bash
git clone https://github.com/Jamessfks/simpleatom.git && cd simpleatom
npm ci
python3 -m pip install -r mace-api/requirements.txt   # exact pins: mace-torch 0.3.16, torch 2.10, ase 3.27, rdkit, torch-dftd
npm run dev                                           # http://localhost:3000 — local mode, no MACE_API_URL needed
```

Open `http://localhost:3000/calculate?demo=true` for a guided run on ethanol.
The first calculation downloads its checkpoint (tens of MB) into `~/.cache/mace`;
later runs load it from there, after its SHA-256 is checked against the pin.

On macOS export `KMP_DUPLICATE_LIB_OK=TRUE` before running Python yourself.

## Check the installation

```bash
export KMP_DUPLICATE_LIB_OK=TRUE
python3 test_scripts/validate_calculation.py --test        # all_passed: true
python3 -m unittest discover -s test_scripts -p "test_backend_contract.py"
npm test && npm run typecheck && npm run build
python3 test_scripts/daily_gate.py --no-bars               # every gate at once
```

## Custom models

Uploaded `.model` checkpoints (fine-tuned MACE) are off by default on every
profile, because loading one executes code from the file. To use your own, start
local mode with `ALLOW_CUSTOM_MODELS=1 npm run dev` and open it at `localhost`:
uploads are accepted only from a loopback host name and only from SimpleAtom's own
pages. `npm run dev` listens on 127.0.0.1; do not expose it to a network while
custom models are enabled.
