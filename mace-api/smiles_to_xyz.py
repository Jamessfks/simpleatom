#!/usr/bin/env python3
"""
SMILES → 3D XYZ converter using RDKit.

Usage:
  python3 smiles_to_xyz.py <smiles_string> [--max-atoms 500]

Parses a SMILES string, refuses ions and radicals, generates 3D coordinates via
ETKDG, optimizes with MMFF94 (UFF where MMFF94 has no parameters), and prints a
JSON result to stdout:

  { "xyz": "...", "num_atoms": 9, "smiles_canonical": "CCO", "formula": "C2H6O",
    "force_field": "MMFF94" }

Called by the Next.js API route (app/api/smiles-to-xyz/route.ts) as a subprocess,
or imported directly by the FastAPI server (main.py).
"""

import json
import sys

MAX_ATOMS_DEFAULT = 500


def smiles_to_xyz(smiles: str, max_atoms: int = MAX_ATOMS_DEFAULT) -> dict:
    """
    Convert a SMILES string to an XYZ block with 3D coordinates.

    Returns dict with keys: xyz, num_atoms, smiles_canonical, formula.
    Raises ValueError on invalid input or conversion failure.
    """
    from rdkit import Chem
    from rdkit.Chem import AllChem, rdMolDescriptors

    if not smiles or not smiles.strip():
        raise ValueError("Empty SMILES string")

    smiles = smiles.strip()

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError(f"Invalid SMILES: '{smiles}' could not be parsed by RDKit")

    canonical = Chem.MolToSmiles(mol)
    formula = rdMolDescriptors.CalcMolFormula(mol)

    # D116: MACE has no total-charge or spin input, and MACE-OFF23 is trained
    # on neutral closed-shell molecules. An ion or a radical used to come back
    # as an ordinary XYZ file and be computed as if neutral and closed-shell
    # (NH4+ as an 11-electron NH4), with nothing to say so.
    from rdkit.Chem import Descriptors
    charge = Chem.GetFormalCharge(mol)
    if charge != 0:
        raise ValueError(
            f"'{smiles}' has a net formal charge of {charge:+d}. MACE models take no charge "
            "input and are trained on neutral systems, so an ion would be computed as if it "
            "were neutral. Use the neutral molecule, or a neutral salt or zwitterion.")
    radicals = Descriptors.NumRadicalElectrons(mol)
    lone_atom = mol.GetNumAtoms() == 1 and mol.GetAtomWithIdx(0).GetTotalNumHs() == 0
    if radicals and not lone_atom:
        # A lone atom is the model's own isolated-atom reference state (and
        # RDKit's radical count for bare metal atoms is arbitrary: [Cu] 1,
        # [Fe] 0), so only multi-atom radicals are refused.
        raise ValueError(
            f"'{smiles}' has {radicals} unpaired (radical) electron{'s' if radicals > 1 else ''}. "
            "MACE models take no spin input and MACE-OFF23 is trained on closed-shell "
            "molecules, so a radical would be computed as something it is not. Use the "
            "closed-shell molecule.")

    mol = Chem.AddHs(mol)
    num_atoms = mol.GetNumAtoms()

    if num_atoms > max_atoms:
        raise ValueError(
            f"Molecule has {num_atoms} atoms (including H), exceeding the "
            f"limit of {max_atoms}. Use a smaller molecule or increase --max-atoms."
        )

    params = AllChem.ETKDGv3()
    params.randomSeed = 42
    status = AllChem.EmbedMolecule(mol, params)

    if status == -1:
        params_fallback = AllChem.ETKDGv3()
        params_fallback.useRandomCoords = True
        params_fallback.randomSeed = 42
        status = AllChem.EmbedMolecule(mol, params_fallback)
        if status == -1:
            raise ValueError(
                f"Failed to generate 3D coordinates for '{smiles}'. "
                "The molecule may be too constrained or unusual for ETKDG embedding."
            )

    # D118: MMFFOptimizeMolecule returns -1 when MMFF94 has no parameters for
    # the molecule (boron, many metals); it does not raise, so the UFF branch
    # never ran and raw ETKDG coordinates were labelled MMFF94. Branch on what
    # each force field reports, and say which one shaped the geometry.
    force_field = None
    if AllChem.MMFFHasAllMoleculeParams(mol) and AllChem.MMFFOptimizeMolecule(mol, maxIters=500) != -1:
        force_field = "MMFF94"
    elif AllChem.UFFHasAllMoleculeParams(mol) and AllChem.UFFOptimizeMolecule(mol, maxIters=500) != -1:
        force_field = "UFF"

    xyz_block = Chem.rdmolfiles.MolToXYZBlock(mol)
    if not xyz_block or not xyz_block.strip():
        raise ValueError("RDKit produced an empty XYZ block")

    lines = xyz_block.strip().split("\n")
    if len(lines) >= 2:
        # D122: quoted, so extended-XYZ readers keep [ ] and + -; a backslash
        # (a stereo bond) is escaped inside the quotes.
        quoted = canonical.replace("\\", "\\\\")
        generator = "RDKit-ETKDG" + (f"+{force_field}" if force_field else "")
        lines[1] = f'SMILES="{quoted}" generator={generator}'
    xyz_block = "\n".join(lines) + "\n"

    return {
        "xyz": xyz_block,
        "num_atoms": num_atoms,
        "smiles_canonical": canonical,
        "formula": formula,
        "force_field": force_field,
    }


if __name__ == "__main__":
    args = sys.argv[1:]
    max_atoms = MAX_ATOMS_DEFAULT

    if "--max-atoms" in args:
        idx = args.index("--max-atoms")
        if idx + 1 >= len(args):
            print(json.dumps({"status": "error", "message": "--max-atoms requires an integer argument"}))
            sys.exit(1)
        try:
            max_atoms = int(args[idx + 1])
        except ValueError:
            print(json.dumps({"status": "error", "message": f"Invalid --max-atoms value: {args[idx + 1]}"}))
            sys.exit(1)
        args = args[:idx] + args[idx + 2:]

    if not args:
        print(json.dumps({
            "status": "error",
            "message": "Usage: python3 smiles_to_xyz.py <smiles_string> [--max-atoms N]",
        }))
        sys.exit(1)

    smiles_input = args[0]

    try:
        result = smiles_to_xyz(smiles_input, max_atoms=max_atoms)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        sys.exit(1)
