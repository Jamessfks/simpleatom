/**
 * The structure files the upload takes, from the request contract
 * (mace-api/contract.json), so the picker and the backend cannot disagree.
 */

import { CONTRACT } from "@/lib/contract";

export function uploadFormats(): { extensions: string[]; bareNames: string[]; accept: string } {
  const extensions = [...CONTRACT.structureExtensions];
  return {
    extensions,
    // An `accept` filter works on extensions, so a file named exactly POSCAR is
    // greyed out in the picker; these can only be dropped onto the box.
    bareNames: Object.keys(CONTRACT.bareStructureNames),
    accept: extensions.join(","),
  };
}
