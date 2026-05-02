import { Button } from "@/components/ui/button";

type VoucherConflictTask = {
    id: string;
    title: string;
    ownerUsername: string;
};

interface DeleteAccountModalProps {
    open: boolean;
    voucherConflicts: VoucherConflictTask[];
    isDeletingAccount: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

export function DeleteAccountModal({
    open,
    voucherConflicts,
    isDeletingAccount,
    onCancel,
    onConfirm,
}: DeleteAccountModalProps) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
            <div className="w-full max-w-xl border border-slate-700 bg-slate-900 p-6">
                <h3 className="text-lg font-semibold text-white">
                    {voucherConflicts.length > 0
                        ? "You are an active voucher"
                        : "Delete account?"}
                </h3>

                {voucherConflicts.length > 0 ? (
                    <div className="mt-4 space-y-4">
                        <p className="text-sm text-slate-300">
                            Deleting your account will remove you as voucher for these tasks. The task owners will not be notified.
                        </p>
                        <ul className="max-h-56 overflow-auto border-y border-slate-800 py-3 text-sm text-slate-200">
                            {voucherConflicts.map((task) => (
                                <li key={task.id} className="border-b border-slate-900 py-2 last:border-b-0">
                                    {"\u2022"} {task.title} {"\u2014"} owned by @{task.ownerUsername}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <p className="mt-4 text-sm text-slate-300">
                        This permanently deletes your account and all associated data. This action cannot be undone.
                    </p>
                )}

                <div className="mt-6 flex justify-end gap-3">
                    <Button
                        type="button"
                        onClick={onCancel}
                        disabled={isDeletingAccount}
                        className="bg-slate-800 text-slate-100 hover:bg-slate-700"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={onConfirm}
                        disabled={isDeletingAccount}
                        className="bg-red-700 hover:bg-red-600 text-white"
                    >
                        {isDeletingAccount
                            ? "Deleting Account..."
                            : voucherConflicts.length > 0
                                ? "Delete Anyway"
                                : "Delete Account"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
