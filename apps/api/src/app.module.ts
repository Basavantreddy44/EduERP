import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import { Db } from './common/prisma.service';
import { AuditService } from './common/audit.service';
import { AccessGuard } from './common/access.guard';
import { ProblemFilter } from './common/problem';
import { AuthService } from './modules/auth/auth.service';
import { AuthController } from './modules/auth/auth.controller';
import { MeController } from './modules/me/me.controller';
import { TenantsService } from './modules/platform/tenants.service';
import { TenantsController } from './modules/platform/tenants.controller';
import { CampusesService } from './modules/campuses/campuses.service';
import { CampusesController } from './modules/campuses/campuses.controller';
import { UsersService } from './modules/users/users.service';
import { UsersController } from './modules/users/users.controller';
import { AuditController } from './modules/audit/audit.controller';
import { HealthController } from './modules/health/health.controller';
import { OutboxService } from './common/outbox.service';
import { SettingsService } from './modules/settings/settings.service';
import { SettingsController } from './modules/settings/settings.controller';
import { NumberingService } from './modules/numbering/numbering.service';
import { NumberingController } from './modules/numbering/numbering.controller';
import { FilesService } from './modules/files/files.service';
import { FilesController } from './modules/files/files.controller';
import { LocalDiskStorage, STORAGE } from './modules/files/storage';
import { NotificationsService } from './modules/notifications/notifications.service';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { ApprovalsService } from './modules/approvals/approvals.service';
import { ApprovalsController } from './modules/approvals/approvals.controller';
import { AcademicService } from './modules/academic/academic.service';
import { AcademicYearsController, DepartmentsController, HolidaysController } from './modules/academic/academic.controller';
import { AccountLinksService } from './modules/auth/account-links.service';
import { EntitlementsService } from './modules/platform/entitlements.service';
import { MyModulesController, PlansController } from './modules/platform/entitlements.controller';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { StructureService } from './modules/structure/structure.service';
import { StructureController } from './modules/structure/structure.controller';
import { AdmissionsService } from './modules/admissions/admissions.service';
import { AdmissionsController } from './modules/admissions/admissions.controller';
import { StudentsService } from './modules/students/students.service';
import { FeeSetupService } from './modules/fees/fee-setup.service';
import { FeeSetupController } from './modules/fees/fee-setup.controller';
import { FeeBillingService } from './modules/fees/billing.service';
import { FeeBillingController } from './modules/fees/billing.controller';
import { FeeCollectionService } from './modules/fees/collection.service';
import { FeeCollectionController } from './modules/fees/collection.controller';
import { FeeOnlineService } from './modules/fees/online.service';
import { FeeOnlineController, PaymentWebhookController, PublicPayController } from './modules/fees/online.controller';
import { PAYMENT_GATEWAY, createGateway } from './modules/fees/gateway';
import { LateFeeService } from './modules/fees/late-fee.service';
import { FeeDuesService } from './modules/fees/dues.service';
import { FeeDuesController } from './modules/fees/dues.controller';
import { StudentsController } from './modules/students/students.controller';
import { StudentsImporter } from './modules/students/students.importer';
import { StudentLifecycleController } from './modules/students/lifecycle.controller';
import { StudentLifecycleService } from './modules/students/lifecycle.service';
import { ImportsService } from './modules/imports/imports.service';
import { ExportsService } from './modules/imports/exports.service';
import { ExportsController, ImportsController } from './modules/imports/imports.controller';
import { AnyImporter, DepartmentsImporter, HolidaysImporter, IMPORTERS, UsersImporter } from './modules/imports/importers';

const isTest = process.env.NODE_ENV === 'test';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: isTest ? 'silent' : process.env.LOG_LEVEL ?? 'info',
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password'],
        transport: config().NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      },
    }),
    JwtModule.register({ secret: config().JWT_ACCESS_SECRET }),
  ],
  controllers: [
    AuthController,
    MeController,
    TenantsController,
    CampusesController,
    UsersController,
    AuditController,
    HealthController,
    SettingsController,
    NumberingController,
    FilesController,
    NotificationsController,
    ApprovalsController,
    AcademicYearsController,
    DepartmentsController,
    HolidaysController,
    PlansController,
    MyModulesController,
    ImportsController,
    ExportsController,
    StructureController,
    AdmissionsController,
    StudentsController,
    StudentLifecycleController,
    FeeSetupController,
    FeeBillingController,
    FeeCollectionController,
    FeeOnlineController,
    PublicPayController,
    PaymentWebhookController,
    FeeDuesController,
  ],
  providers: [
    Db,
    AuditService,
    AuthService,
    TenantsService,
    CampusesService,
    UsersService,
    OutboxService,
    SettingsService,
    NumberingService,
    FilesService,
    { provide: STORAGE, useClass: LocalDiskStorage },
    NotificationsService,
    ApprovalsService,
    AcademicService,
    AccountLinksService,
    EntitlementsService,
    DepartmentsImporter,
    HolidaysImporter,
    UsersImporter,
    {
      provide: IMPORTERS,
      useFactory: (...i: AnyImporter[]) => i,
      inject: [DepartmentsImporter, HolidaysImporter, UsersImporter, StudentsImporter],
    },
    ImportsService,
    ExportsService,
    StructureService,
    AdmissionsService,
    StudentsService,
    StudentLifecycleService,
    FeeSetupService,
    FeeBillingService,
    FeeCollectionService,
    FeeOnlineService,
    { provide: PAYMENT_GATEWAY, useFactory: createGateway },
    LateFeeService,
    FeeDuesService,
    StudentsImporter,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
