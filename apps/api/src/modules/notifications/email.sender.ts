import { Injectable, OnModuleDestroy } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../../config';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/** SMTP sender (Mailpit locally). Plain-text bodies only: template values are never interpreted as HTML. */
@Injectable()
export class EmailSender implements OnModuleDestroy {
  private transport: Transporter | null = null;

  get configured(): boolean {
    return !!config().SMTP_HOST;
  }

  private get t(): Transporter {
    if (!this.transport) {
      const c = config();
      this.transport = nodemailer.createTransport({
        host: c.SMTP_HOST,
        port: c.SMTP_PORT,
        secure: c.SMTP_SECURE === 'true',
        auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASS } : undefined,
        connectionTimeout: 10_000,
        socketTimeout: 20_000,
      });
    }
    return this.transport;
  }

  async send(mail: OutgoingEmail): Promise<{ provider: string; messageId: string }> {
    const info = await this.t.sendMail({ from: config().MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text });
    return { provider: 'smtp', messageId: String(info.messageId ?? '') };
  }

  onModuleDestroy(): void {
    this.transport?.close();
  }
}
