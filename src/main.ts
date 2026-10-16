import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth/auth.config.js';
import express from 'express';
import type { Request } from 'express';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';

/** TRUST_PROXY: "true", número de proxies ou lista de IPs/sub-redes; vazio = não confia. */
function parseTrustProxy(
  value: string | undefined,
): boolean | number | string | null {
  if (!value || value === 'false') return null;
  if (value === 'true') return true;

  const hops = Number(value);

  return Number.isInteger(hops) ? hops : value;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // Necessário: Better Auth precisa do body stream raw
  });

  app.enableCors({
    origin: [process.env.FRONTEND_URL || 'http://localhost:5173'],
    credentials: true,
  });

  // IP real do pagador atrás de proxy: antifraude do cartão e limites do checkout
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

  if (trustProxy !== null) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  }

  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // 1. Montar Better Auth em /api/auth/* ANTES do body parser
  app.use('/api/auth', toNodeHandler(auth));

  // 2. Re-habilitar JSON e Urlencoded parsing para todas as outras rotas. O corpo bruto fica
  // guardado para os webhooks dos provedores que assinam o corpo (HMAC).
  app.use(
    express.json({
      verify: (request, _response, buffer) => {
        (request as Request & { rawBody?: Buffer }).rawBody = buffer;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));

  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
