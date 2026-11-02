import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, isSmilesGenerated, readError, smilesToFile } from "@/lib/api-client";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

// D59: every route answers errors as {status:"error", message, error:{code,
// message, field}}. The SMILES box and the molecule editor read `error` as a
// string and printed "[object Object]". They now share one reader.
describe("server errors reach the user as sentences (D59)", () => {
  it("reads the current error envelope", async () => {
    const err = await readError(
      json(400, {
        status: "error",
        message: "Invalid SMILES: nope",
        error: { code: "backend_error", message: "Invalid SMILES: nope", field: null },
      }),
    );
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.message).toBe("Invalid SMILES: nope");
    expect(err.code).toBe("backend_error");
  });

  it("converts a SMILES string to a named structure file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { status: "success", xyz: "3\n\nO 0 0 0\nH 0 0 1\nH 0 1 0\n", smiles_canonical: "O" })),
    );
    const file = await smilesToFile("  O ");
    expect(file.name).toBe("smiles_O.xyz");
    expect(await file.text()).toContain("O 0 0 0");
  });

  it("raises the server's message for a rejected SMILES, never [object Object]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(422, {
          status: "error",
          message: "SMILES is too long.",
          error: { code: "limit_exceeded", message: "SMILES is too long.", field: "smiles" },
        }),
      ),
    );
    const err = await smilesToFile("C".repeat(600)).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.message).toBe("SMILES is too long.");
    expect(err.message).not.toContain("[object Object]");
    expect(err.field).toBe("smiles");
  });

  it("does not parse a platform error page as JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Payload Too Large</html>", { status: 413 })));
    const err = await smilesToFile("CCO").catch((e) => e);
    expect(err.message).toMatch(/too large/i);
  });
});

// D69 (F24): a file's NAME must not decide the model. SMILES-generated files
// are marked by how they were made, not by a "smiles_" prefix.
describe("SMILES-generated files are marked, not guessed from the name (D69)", () => {
  it("marks the file smilesToFile makes, and not a user file with the same prefix", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { status: "success", xyz: "1\n\nH 0 0 0\n", smiles_canonical: "[H]" })),
    );
    const made = await smilesToFile("[H]");
    expect(isSmilesGenerated(made)).toBe(true);
    expect(isSmilesGenerated(new File(["x"], made.name))).toBe(false);
    expect(isSmilesGenerated(new File(["x"], "smiles_crystal.cif"))).toBe(false);
  });
});

// The only error code the UI branches on is "cancelled" (app/calculate/page.tsx).
// Every other code falls through to the server's own sentence, so a code the
// backend adds later needs no table entry: its message and code arrive intact.
describe("the backend's input and run refusals reach the user in the server's words", () => {
  const codes = [
    "non_finite_result",
    "overlapping_atoms",
    "partial_occupancy",
    "ambiguous_element",
    "unknown_element",
    "ambiguous_origin_choice",
    "md_diverged",
    "invalid_cell",
    "npt_requires_triangular_cell",
  ];

  for (const code of codes) {
    it(code, async () => {
      const message = `The server's own sentence for ${code}. Nothing was computed.`;
      const err = await readError(json(422, { status: "error", message, error: { code, message, field: "structure" } }));
      expect(err).toBeInstanceOf(ApiRequestError);
      expect(err.message).toBe(message);
      expect(err.code).toBe(code);
      expect(err.field).toBe("structure");
      expect(err.status).toBe(422);
    });
  }
});
