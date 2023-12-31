import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/utils/api";
import { type Guest } from "@prisma/client";
import { type ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import DataTable from "./DataTable";

import { LoadingPage } from "./loading";

export const columns: ColumnDef<Guest>[] = [
  {
    id: "select",

    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "id",
    header: () => <div className="">Guest ID</div>,
    cell: ({ row }) => {
      const guestId: string = row.getValue("id");
      return (
        <Link href={`/accounts/${guestId}`} className="uppercase underline">
          {guestId.slice(0, 10)}...
        </Link>
      );
    },
  },
  {
    accessorKey: "fullName",
    header: "Name",
  },
  {
    accessorKey: "email",
    header: "Email",
  },
  {
    accessorKey: "type",
    header: "Type",
  },
];

export function GuestsTable() {
  const { data: guests, isLoading } = api.guests.getAll.useQuery();
  if (isLoading) return <LoadingPage />;
  if (!guests) return null;
  return (
    <DataTable
      displayFilter={true}
      filterColumn="fullName"
      data={guests}
      columns={columns}
    />
  );
}
