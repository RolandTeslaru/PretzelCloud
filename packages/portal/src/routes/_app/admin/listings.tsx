import { createFileRoute } from '@tanstack/react-router'
import { AdminSDK } from '@/SDKs/AdminSDK'
import { AdminListings } from '@/SDKs/AdminSDK/ui/AdminListings'

export const Route = createFileRoute('/_app/admin/listings')({
    loader: () => {
        void AdminSDK.prefetch(AdminSDK.query.listingsList)

        return null
    },
    staticData: { title: 'All listings' },
    component: AdminListings,
})
