/**
 * Generate kode referral pendek & mudah diketik/dibagikan (6 karakter,
 * huruf besar + angka, tanpa karakter ambigu seperti 0/O atau 1/I/L).
 */
export function generateReferralCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
