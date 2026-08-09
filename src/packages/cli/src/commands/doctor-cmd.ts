import { doctor, formatDoctorReport } from '@mastishk/core';
import type { DoctorReport } from '@mastishk/core';
import { mastishkDir, assertMastishkExists } from '../utils.js';

// Spec section 11 — `mastishk doctor` validates the entire memory folder and
// prints actionable findings with a non-zero exit code on any MUST-level violation.

export interface DoctorCommandOptions {
  cwd?: string;
}

export async function doctorCommand(
  options: DoctorCommandOptions = {}
): Promise<DoctorReport> {
  const cwd = options.cwd ?? process.cwd();
  await assertMastishkExists(cwd);

  const report = await doctor(mastishkDir(cwd));
  console.log(formatDoctorReport(report));
  return report;
}
