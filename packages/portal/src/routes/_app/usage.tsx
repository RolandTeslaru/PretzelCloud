import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/usage')({
    staticData: { title: 'Usage' },
    component: Usage,
})

function Usage() {
    return (
        <p className="text-muted-foreground text-sm">
            Nothing is metered yet.
        </p>
    )
}
