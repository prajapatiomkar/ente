import type { CollectionSummary } from "@/new/photos/types/collection";
import { CollectionsSortBy } from "@/new/photos/types/collection";
import {
    FlexWrapper,
    FluidContainer,
    IconButtonWithBG,
} from "@ente/shared/components/Container";
import Close from "@mui/icons-material/Close";
import {
    Box,
    DialogTitle,
    Divider,
    Stack,
    Typography,
    useMediaQuery,
} from "@mui/material";
import {
    AllCollectionDialog,
    Transition,
} from "components/Collections/AllCollections/dialog";
import { t } from "i18next";
import { CollectionsSortOptions } from "../CollectionsSortOptions";
import AllCollectionContent from "./content";

interface AllCollectionsProps {
    open: boolean;
    onClose: () => void;
    collectionSummaries: CollectionSummary[];
    setActiveCollectionID: (id?: number) => void;
    collectionsSortBy: CollectionsSortBy;
    onChangeCollectionsSortBy: (by: CollectionsSortBy) => void;
    isInHiddenSection: boolean;
}

const LeftSlideTransition = Transition("up");

export default function AllCollections(props: AllCollectionsProps) {
    const {
        collectionSummaries,
        open,
        onClose,
        setActiveCollectionID,
        collectionsSortBy,
        onChangeCollectionsSortBy,
        isInHiddenSection,
    } = props;
    const isMobile = useMediaQuery("(max-width: 428px)");

    const onCollectionClick = (collectionID: number) => {
        setActiveCollectionID(collectionID);
        onClose();
    };

    return (
        <AllCollectionDialog
            position="flex-end"
            TransitionComponent={LeftSlideTransition}
            onClose={onClose}
            open={open}
            fullScreen={isMobile}
            fullWidth={true}
        >
            <AllCollectionsHeader
                {...{
                    isInHiddenSection,
                    onClose,
                    collectionsSortBy,
                    onChangeCollectionsSortBy,
                }}
                collectionCount={props.collectionSummaries.length}
            />
            <Divider />
            <AllCollectionContent
                collectionSummaries={collectionSummaries}
                onCollectionClick={onCollectionClick}
            />
        </AllCollectionDialog>
    );
}

const AllCollectionsHeader = ({
    onClose,
    collectionCount,
    collectionsSortBy,
    onChangeCollectionsSortBy,
    isInHiddenSection,
}) => (
    <DialogTitle>
        <FlexWrapper>
            <FluidContainer mr={1.5}>
                <Box>
                    <Typography variant="h3">
                        {isInHiddenSection
                            ? t("all_hidden_albums")
                            : t("all_albums")}
                    </Typography>
                    <Typography variant="small" color={"text.muted"}>
                        {t("albums_count", { count: collectionCount })}
                    </Typography>
                </Box>
            </FluidContainer>
            <Stack direction="row" spacing={1.5}>
                <CollectionsSortOptions
                    activeSortBy={collectionsSortBy}
                    onChangeSortBy={onChangeCollectionsSortBy}
                    nestedInDialog
                />
                <IconButtonWithBG onClick={onClose}>
                    <Close />
                </IconButtonWithBG>
            </Stack>
        </FlexWrapper>
    </DialogTitle>
);
