import { proofFields, proofObjectKey } from './proof-file.js';

describe('proof file', () => {
  it('picks the extension by the file type', () => {
    expect(proofObjectKey('org-1', 'inv-1', 'tx-1', 'image/jpeg')).toBe(
      'organizations/org-1/invoices/inv-1/tx-1.jpg',
    );
    expect(proofObjectKey('org-1', 'inv-1', 'tx-1', 'image/png')).toMatch(
      /\.png$/,
    );
    expect(proofObjectKey('org-1', 'inv-1', 'tx-1', 'image/webp')).toMatch(
      /\.webp$/,
    );
    expect(proofObjectKey('org-1', 'inv-1', 'tx-1', 'application/pdf')).toMatch(
      /\.pdf$/,
    );
  });

  it('never puts the original name in the key', () => {
    const file = {
      buffer: Buffer.from('abc'),
      mimetype: 'application/pdf',
      originalname: 'comprovante joão.pdf',
      size: 3,
    };
    const key = proofObjectKey('org-1', 'inv-1', 'tx-1', file.mimetype);

    expect(key).not.toContain('comprovante');
    expect(proofFields(file, key)).toEqual({
      proofKey: key,
      proofMimeType: 'application/pdf',
      proofSize: 3,
      proofName: 'comprovante joão.pdf',
      // sha256("abc")
      proofSha256:
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
  });

  it('keeps only the file name, limited to 200 characters', () => {
    const fields = proofFields(
      {
        buffer: Buffer.from(''),
        mimetype: 'image/png',
        originalname: `C:\\fakepath\\${'a'.repeat(250)}.png`,
        size: 0,
      },
      'key',
    );

    expect(fields.proofName).toHaveLength(200);
    expect(fields.proofName.startsWith('a')).toBe(true);
  });
});
