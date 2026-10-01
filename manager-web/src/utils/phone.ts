/**
 * A driver's number on screen: every digit but the last two (audit 11, E2E-R1).
 * The full number goes only where it is dialled, a `tel:` href; nothing reads
 * it aloud, prints it, or leaves it on a screen somebody photographs.
 */

/** "+919435012345" -> "+•••••••••••45". */
export const maskPhone = (phone: string): string => phone.replace(/\d(?=(?:\D*\d){2})/g, '•')

/** A sentence the server wrote with numbers in it (the SOS dossier's SOP
 *  steps), with exactly those numbers masked and nothing else touched. */
export function maskPhonesIn(text: string, phones: (string | null | undefined)[]): string {
  return phones.reduce<string>((out, phone) => (phone ? out.split(phone).join(maskPhone(phone)) : out), text)
}
