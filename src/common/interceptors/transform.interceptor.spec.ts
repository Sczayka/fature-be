import { Redirect, StreamableFile } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor.js';

class RedirectingController {
  @Redirect()
  open() {
    return { url: 'https://example.com/file.pdf', statusCode: 302 };
  }

  plain() {
    return null;
  }
}

function intercept(
  data: unknown,
  handler: () => unknown = RedirectingController.prototype.plain,
) {
  const context: any = {
    switchToHttp: () => ({ getRequest: () => ({ url: '/logos/org-1' }) }),
    getHandler: () => handler,
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

  it('leaves the redirect target for @Redirect() routes', async () => {
    const target = { url: 'https://example.com/file.pdf', statusCode: 302 };

    await expect(
      intercept(target, RedirectingController.prototype.open),
    ).resolves.toBe(target);
  });
});
