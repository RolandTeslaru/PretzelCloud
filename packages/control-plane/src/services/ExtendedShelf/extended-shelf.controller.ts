import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ExtendedShelf, Listing } from '@pretzel-cloud/shared/domain';
import { UserAuthGuard } from '@/auth/guards/user-auth.guard';
import { OperatorGuard } from '@/auth/guards/operator.guard';
import { ExtendedShelfService } from './extended-shelf.service';

// The extended shelf: an open read for every workspace, operator-only tagging.
@Controller()
export class ExtendedShelfController {

    constructor(private readonly extendedShelf: ExtendedShelfService) {}


    @Get('extended-shelf')
    public async getAll(): Promise<ExtendedShelf.API.List.Response> {
        return { workflows: await this.extendedShelf.getAll() };
    }

    @Put('admin/extended-shelf/:id')
    @UseGuards(UserAuthGuard, OperatorGuard)
    public async add(
        @Param('id') id: string,
        @Body() body: unknown,
    ): Promise<Record<string, never>> {
        const { blueprintId } = ExtendedShelf.API.Add.Request.parse(body);

        await this.extendedShelf.operator.add(Listing.Id.parse(id), blueprintId);

        return {};
    }

    @Delete('admin/extended-shelf/:id')
    @UseGuards(UserAuthGuard, OperatorGuard)
    public async remove(@Param('id') id: string): Promise<Record<string, never>> {
        await this.extendedShelf.operator.remove(Listing.Id.parse(id));

        return {};
    }
}
