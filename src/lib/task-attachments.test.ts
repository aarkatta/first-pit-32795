import { describe, expect, it } from 'vitest';
import { attachmentProblem } from './task-attachments';

describe('attachmentProblem', () => {
  it('accepts the server-approved types up to 10 MB', () => {
    expect(attachmentProblem(new File(['x'], 'a.png', { type: 'image/png' }))).toBeNull();
    expect(attachmentProblem(new File(['x'], 'a.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))).toMatch(/can't be attached/);
    expect(attachmentProblem(new File([], 'empty.txt', { type: 'text/plain' }))).toMatch(/empty/);
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    expect(attachmentProblem(big)).toMatch(/larger than 10 MB/);
  });
});
