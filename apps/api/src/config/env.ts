export function assertBooleanEnvironmentValue(name: string, value: string | undefined): void {
  if (value !== undefined && value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false`);
  }
}

export function parseUiSurfaceV3Environment(value: string | undefined): boolean {
  assertBooleanEnvironmentValue("ARDEN_AI_UI_SURFACE_V3", value);
  return value !== "false";
}
