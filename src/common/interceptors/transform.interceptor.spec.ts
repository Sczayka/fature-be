import { StreamableFile } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor.js';

function intercept(data: unknown) {
  const context: any = {
    switchToHttp: () => ({ getRequest: () => ({ url: '/logos/org-1' }) }),
  };

  return lastValueFrom(
    new TransformInterceptor().intercept(context, { handle: () => of(data) }),
  );
}

describe('TransformInterceptor', () => {
  it('wraps the response in the success envelope', async () => {
    await expect(intercept({ id: 1 })).resolves.toEqual({
      success: true,
      data: { id: 1 },
    });
  });

  it('sends files without the envelope', async () => {
    const file = new StreamableFile(new Uint8Array([1, 2, 3]));

    await expect(intercept(file)).resolves.toBe(file);
  });
});
