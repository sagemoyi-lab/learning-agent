/** Empty subscription lists mean no subscription; omitted lists default at the caller. */
export function feedMatches(type: string, key: string): boolean {
  return key !== '' && key.split('|').some(prefix => prefix !== '' && type.startsWith(prefix))
}
