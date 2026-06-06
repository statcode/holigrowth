// Minimal shim for `tz-lookup` — no @types package ships on npm.
// The package exports a single function that maps lat/lng to an IANA TZ name.
declare module "tz-lookup" {
  const fn: (latitude: number, longitude: number) => string;
  export default fn;
}
