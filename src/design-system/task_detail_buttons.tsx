import type { ReactNode } from "react";
import { AlertTriangle, Camera, Plus, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PomoButton } from "@/components/ui/PomoButton";
import { cn } from "@/lib/utils";

export const TASK_DETAIL_BUTTON_CLASSES = {
    size: {
        uniform: "h-9 px-4 text-[12px] leading-none whitespace-nowrap",
        active: "h-12 px-5 text-[13px] leading-none whitespace-nowrap",
    },
    awaiting: {
        addProof: "bg-transparent border-pink-400/35 text-pink-400 hover:bg-pink-400/10 hover:border-pink-400/55 hover:text-pink-300",
        undoComplete: "bg-transparent border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200",
        resubmitProof: "flex items-center gap-2 rounded border border-pink-400/35 bg-pink-400/10 text-pink-400 hover:bg-pink-400/20 hover:text-pink-300 transition-colors cursor-pointer disabled:opacity-50",
        escalateToFriend: "border border-blue-700/40 bg-blue-900/15 text-blue-300 hover:bg-blue-800/25 hover:text-blue-100",
    },
    proof: {
        removeStored: "ml-auto h-7 px-2 text-[11px] text-pink-400/80 hover:text-pink-300 bg-transparent hover:bg-pink-950/30 border border-pink-400/30",
        removeDraft: "ml-auto h-7 px-2 text-[11px] text-pink-400/70 hover:text-pink-300 bg-transparent border border-pink-400/25",
    },
    actions: {
        attachProofBase: "h-12 w-full p-0 border transition-all justify-center",
        attachProofAttached: "border-pink-400/40 bg-pink-400/10 text-pink-400",
        attachProofEnabled: "border-pink-400/35 bg-pink-400/10 text-pink-400 hover:bg-pink-400/20 hover:text-pink-300",
        attachProofDisabled: "border-slate-800 text-slate-700 cursor-not-allowed",
        markCompleteEnabled: "border-emerald-500/35 bg-emerald-500/8 text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200",
        markCompleteDisabled: "border-slate-800 bg-transparent text-slate-500 cursor-not-allowed",
        postponeEnabled: "border-amber-500/35 bg-amber-500/8 text-amber-300 hover:bg-amber-500/15 hover:border-amber-500/45 hover:text-amber-200",
        postponeDisabled: "border-slate-800 bg-transparent text-slate-500 cursor-not-allowed",
        stopRepeatingEnabled: "border-red-900/40 bg-red-950/15 text-red-400/80 hover:bg-red-900/25 hover:text-red-300",
        stopRepeatingDisabled: "border-slate-800 text-slate-600 cursor-not-allowed",
        overrideEnabled: "border-[#a21caf]/70 bg-[#a21caf]/20 text-[#f5d0fe] hover:bg-[#a21caf]/30 hover:text-[#fae8ff]",
        overrideDisabled: "border-slate-800 text-slate-600 cursor-not-allowed",
        deleteEnabled: "border-red-900/40 bg-red-950/15 text-red-400/80 hover:bg-red-900/25 hover:text-red-300",
        deleteDisabled: "border-slate-800 text-slate-700 cursor-not-allowed",
        toggleBase: "w-full justify-between border px-3",
        toggleOpen: "border-slate-600 bg-slate-900/70 text-slate-200",
        toggleClosed: "border-slate-800 bg-slate-900/30 text-slate-400 hover:bg-slate-900/50 hover:text-slate-300",
        toggleDisabled: "border-slate-800 text-slate-700 cursor-not-allowed",
        addReminder: "h-8 text-[11px] bg-transparent border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700 disabled:opacity-30",
        addSubtask: "h-8 w-8 p-0 bg-transparent border border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700 disabled:opacity-30",
        pomoButton: "h-12 w-full",
        pomoWrapperDisabled: "pointer-events-none opacity-45 saturate-0",
    },
} as const;

interface ShowcaseItem {
    title: string;
    render: () => ReactNode;
}

interface TaskDetailButtonsShowcaseSectionProps {
    sectionNumber?: number;
    sectionItemLabel: (section: number, item: number) => string;
}

export function TaskDetailButtonsShowcaseSection({
    sectionNumber = 9,
    sectionItemLabel,
}: TaskDetailButtonsShowcaseSectionProps) {
    const primaryActions: ShowcaseItem[] = [
        {
            title: "Pomodoro",
            render: () => (
                <PomoButton
                    taskId="design-showcase-task"
                    variant="full"
                    className={TASK_DETAIL_BUTTON_CLASSES.actions.pomoButton}
                    defaultDurationMinutes={25}
                    fullDurationSuffixText="m pomodoro?"
                />
            ),
        },
        {
            title: "Mark Complete",
            render: () => (
                <Button className={cn(TASK_DETAIL_BUTTON_CLASSES.size.active, "w-full justify-center transition-all border", TASK_DETAIL_BUTTON_CLASSES.actions.markCompleteEnabled)}>
                    Mark Complete
                </Button>
            ),
        },
        {
            title: "Postpone",
            render: () => (
                <Button
                    variant="outline"
                    className={cn(TASK_DETAIL_BUTTON_CLASSES.size.active, "w-full justify-center border", TASK_DETAIL_BUTTON_CLASSES.actions.postponeEnabled)}
                >
                    Postpone once?
                </Button>
            ),
        },
        {
            title: "Stop Repeating",
            render: () => (
                <Button
                    variant="ghost"
                    className={cn(TASK_DETAIL_BUTTON_CLASSES.size.active, "w-full justify-center border", TASK_DETAIL_BUTTON_CLASSES.actions.stopRepeatingEnabled)}
                >
                    <Repeat className="mr-1.5 h-3.5 w-3.5" />
                    Stop Repeating
                </Button>
            ),
        },
        {
            title: "Use Override",
            render: () => (
                <Button
                    variant="ghost"
                    className={cn(TASK_DETAIL_BUTTON_CLASSES.size.active, "w-full justify-center border", TASK_DETAIL_BUTTON_CLASSES.actions.overrideEnabled)}
                >
                    Use Override
                </Button>
            ),
        },
        {
            title: "Delete Task",
            render: () => (
                <Button
                    variant="ghost"
                    className={cn("h-12 w-full p-0 border transition-colors justify-center", TASK_DETAIL_BUTTON_CLASSES.actions.deleteEnabled)}
                >
                    <Trash2 className="h-5 w-5" />
                </Button>
            ),
        },
        {
            title: "Toggle Section (open)",
            render: () => (
                <Button
                    variant="ghost"
                    className={cn(TASK_DETAIL_BUTTON_CLASSES.size.active, TASK_DETAIL_BUTTON_CLASSES.actions.toggleBase, TASK_DETAIL_BUTTON_CLASSES.actions.toggleOpen)}
                >
                    <span className="text-[13px] leading-none">Subtasks</span>
                    <span className="text-[13px] leading-none opacity-80">2/4</span>
                </Button>
            ),
        },
        {
            title: "Toggle Section (closed)",
            render: () => (
                <Button
                    variant="ghost"
                    className={cn(TASK_DETAIL_BUTTON_CLASSES.size.active, TASK_DETAIL_BUTTON_CLASSES.actions.toggleBase, TASK_DETAIL_BUTTON_CLASSES.actions.toggleClosed)}
                >
                    <span className="text-[13px] leading-none">Reminders</span>
                    <span className="text-[13px] leading-none opacity-80">1</span>
                </Button>
            ),
        },
        {
            title: "Disabled State",
            render: () => (
                <Button
                    disabled
                    className={cn(TASK_DETAIL_BUTTON_CLASSES.size.active, "w-full justify-center transition-all border", TASK_DETAIL_BUTTON_CLASSES.actions.markCompleteDisabled)}
                >
                    Mark Complete
                </Button>
            ),
        },
    ];

    const semanticActions: ShowcaseItem[] = [
        {
            title: "Add Proof (awaiting)",
            render: () => (
                <Button
                    variant="outline"
                    className={cn(TASK_DETAIL_BUTTON_CLASSES.size.uniform, TASK_DETAIL_BUTTON_CLASSES.awaiting.addProof)}
                >
                    <Camera className="mr-1.5 h-3.5 w-3.5" />
                    Add Proof
                </Button>
            ),
        },
        {
            title: "Undo Complete (awaiting)",
            render: () => (
                <Button
                    variant="outline"
                    className={cn(TASK_DETAIL_BUTTON_CLASSES.size.uniform, TASK_DETAIL_BUTTON_CLASSES.awaiting.undoComplete)}
                >
                    Undo Complete
                </Button>
            ),
        },
        {
            title: "Resubmit Proof",
            render: () => (
                <button
                    type="button"
                    className={cn(TASK_DETAIL_BUTTON_CLASSES.awaiting.resubmitProof, TASK_DETAIL_BUTTON_CLASSES.size.uniform)}
                >
                    <Camera className="h-3.5 w-3.5" />
                    Upload New Proof
                </button>
            ),
        },
        {
            title: "Escalate to Friend",
            render: () => (
                <Button
                    variant="ghost"
                    className={cn(TASK_DETAIL_BUTTON_CLASSES.size.uniform, TASK_DETAIL_BUTTON_CLASSES.awaiting.escalateToFriend)}
                >
                    <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                    Escalate to Friend
                </Button>
            ),
        },
        {
            title: "Remove Stored Proof",
            render: () => (
                <Button variant="ghost" className={TASK_DETAIL_BUTTON_CLASSES.proof.removeStored}>
                    Remove
                </Button>
            ),
        },
        {
            title: "Add Reminder",
            render: () => (
                <Button variant="outline" className={TASK_DETAIL_BUTTON_CLASSES.actions.addReminder}>
                    Add
                </Button>
            ),
        },
        {
            title: "Add Subtask",
            render: () => (
                <Button size="sm" className={TASK_DETAIL_BUTTON_CLASSES.actions.addSubtask}>
                    <Plus className="h-4 w-4" />
                </Button>
            ),
        },
    ];

    let itemIndex = 0;
    const nextLabel = () => {
        itemIndex += 1;
        return sectionItemLabel(sectionNumber, itemIndex);
    };

    return (
        <section className="space-y-6">
            <h2 className="text-2xl font-semibold text-white border-b border-slate-800 pb-3">9. Task Detail Buttons</h2>
            <p className="text-sm text-slate-500 leading-relaxed">
                Ground-truth button styles for the task detail page. Update this module to change both task detail and showcase previews.
            </p>

            <div className="space-y-10">
                <div className="space-y-4">
                    <div>
                        <h3 className="text-base font-semibold text-slate-200">Primary Actions</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Main action row variants from the task detail action grid.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                        {primaryActions.map((item) => (
                            <div key={item.title} className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{nextLabel()} {item.title}</p>
                                {item.render()}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-4">
                    <div>
                        <h3 className="text-base font-semibold text-slate-200">Semantic Action Buttons</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Proof, escalation, and reminder controls from task detail status/action blocks.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                        {semanticActions.map((item) => (
                            <div key={item.title} className="space-y-1.5 py-3 px-4">
                                <p className="text-[10px] font-mono text-slate-500">{nextLabel()} {item.title}</p>
                                {item.render()}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}
