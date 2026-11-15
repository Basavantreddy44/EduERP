import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { config } from './config';
import { mountApiDocs } from './openapi';

/** Builds the HTTP app. Shared by main.ts and the integration tests so tests exercise the real pipeline. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true } /* raw body: webhook signatures */);
  app.useLogger(app.get(Logger));
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config().WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  const cfg = config();
  if (cfg.API_DOCS === 'on' || (cfg.API_DOCS === undefined && cfg.NODE_ENV !== 'production')) mountApiDocs(app);
  return app;
}
