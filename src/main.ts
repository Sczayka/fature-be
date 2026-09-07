import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth/auth.config.js';
import express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // Necessário: Better Auth precisa do body stream raw
  });

  app.enableCors({
    origin: [process.env.FRONTEND_URL || 'http://localhost:5173'],
    credentials: true,
  });

  // 1. Montar Better Auth em /api/auth/* ANTES do body parser
  app.use('/api/auth', toNodeHandler(auth));

  // 2. Re-habilitar JSON e Urlencoded parsing para todas as outras rotas
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  await app.listen(process.env.PORT ?? 3000);
}

await bootstrap();
