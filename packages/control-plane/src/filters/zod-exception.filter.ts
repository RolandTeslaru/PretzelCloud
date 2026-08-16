import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/** A schema rejection is a bad request, not a 500. */
@Catch()
export class ZodExceptionFilter implements ExceptionFilter {

    catch(exception: unknown, host: ArgumentsHost): void {
        const response = host.switchToHttp().getResponse<Response>();

        if (exception instanceof ZodError) {
            response.status(HttpStatus.BAD_REQUEST).json({
                statusCode: HttpStatus.BAD_REQUEST,
                message: exception.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
            });

            return;
        }

        if (exception instanceof HttpException) {
            response.status(exception.getStatus()).json(exception.getResponse());

            return;
        }

        console.error(exception);

        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Internal server error',
        });
    }
}
