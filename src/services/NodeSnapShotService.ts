import {Node, Organization} from "@stellarbeat/js-stellar-domain";
import NodeDetailsStorage from "../entities/NodeDetailsStorage";
import GeoDataStorage from "../entities/GeoDataStorage";
import NodeSnapShot from "../entities/NodeSnapShot";
import CrawlV2 from "../entities/CrawlV2";
/*import slugify from "@sindresorhus/slugify";
import OrganizationIdStorage from "../entities/OrganizationIdStorage";
import OrganizationStorageV2 from "../entities/OrganizationStorageV2";*/
import NodeSnapShotRepository from "../repositories/NodeSnapShotRepository";
import QuorumSetStorage from "../entities/QuorumSetStorage";
import NodeStorageV2 from "../entities/NodeStorageV2";

export default class NodeSnapShotService {

    protected nodeSnapShotRepository: NodeSnapShotRepository;

    constructor(
        nodeSnapShotRepository: NodeSnapShotRepository
    )
    {
        this.nodeSnapShotRepository = nodeSnapShotRepository;
    }

    async update(crawledNodes:Node[], crawl: CrawlV2) {
        let crawledNodesMap = new Map(crawledNodes
                .filter(node => node.publicKey)
                .map(node => [node.publicKey, node])
            );
        let crawledNodesToProcess = new Set(crawledNodes.map(node => node.publicKey));

        let latestSnapShots = await this.nodeSnapShotRepository.findLatest();
        let snapShotsToSave:NodeSnapShot[] = [];

        await Promise.all(latestSnapShots.map(async (snapShot: NodeSnapShot) => { //todo NOT ASYNC? delay db actions to end?
            if(crawledNodesToProcess.has(snapShot.nodeStorage.publicKey)){
                let crawledNode = crawledNodesMap.get(snapShot.nodeStorage.publicKey);
                if(!crawledNode) {
                    throw Error('Crawled node not found but should be present: ' + snapShot.nodeStorage.publicKey);
                }
                crawledNodesToProcess.delete(snapShot.nodeStorage.publicKey);
                console.log('node found in latest crawl: ' + crawledNode.publicKey);

                if(!this.hasNodeChanged(snapShot, crawledNode)) {
                    return;
                }
                console.log('node has changed in latest crawl: ' + crawledNode.publicKey);
                snapShot.crawlEnd = crawl;
                snapShotsToSave.push(snapShot);
                snapShotsToSave.push(this.createUpdatedSnapShot(snapShot, crawledNode, crawl));
            }
            //todo handle snapshots that are not crawled: could happen when a node changes public key
        }));

        //Todo: handle crawled nodes that have no snapshot

        await this.nodeSnapShotRepository.save(snapShotsToSave);
    }

    private createUpdatedSnapShot(snapShot: NodeSnapShot, crawledNode:Node, crawl: CrawlV2) {
        let newSnapShot = new NodeSnapShot(snapShot.nodeStorage, crawledNode.ip, crawledNode.port, crawl);
        if (!this.quorumSetChanged(crawledNode, snapShot))
            newSnapShot.quorumSet = snapShot.quorumSet;
        else {
            newSnapShot.quorumSet = QuorumSetStorage.fromQuorumSet(crawledNode.quorumSet);
        }

        if (!this.nodeDetailsChanged(crawledNode, snapShot))
            newSnapShot.nodeDetails = snapShot.nodeDetails;
        else {
            newSnapShot.nodeDetails = NodeDetailsStorage.fromNode(crawledNode);
        }

        if (!this.geoDataChanged(crawledNode, snapShot))
            newSnapShot.geoData = snapShot.geoData;
        else
            newSnapShot.geoData = GeoDataStorage.fromGeoData(crawledNode.geoData);

        /*if (!organizationChanged) {
            latestNodeStorageV2.organization = //new org storage
            //Todo
        }*/

        return newSnapShot;
    }

    async hasNodeChanged(nodeSnapShot: NodeSnapShot, crawledNode: Node, organization?: Organization) {
            if (this.quorumSetChanged(crawledNode, nodeSnapShot))
                return true;
            if (this.nodeIpPortChanged(crawledNode, nodeSnapShot))
                return true;
            if (this.nodeDetailsChanged(crawledNode, nodeSnapShot))
                return true;
            if (this.geoDataChanged(crawledNode, nodeSnapShot))
                return true;
            /*if (nodeService.organizationChanged(node, organization))
                organizationChanged = true;*/

            return false
    }

    async createNewNodeSnapShot(nodeStorage:NodeStorageV2, node: Node, crawlStart: CrawlV2, organization?: Organization) {
        let nodeSnapShot = new NodeSnapShot(nodeStorage, node.ip, node.port, crawlStart);

        nodeSnapShot.quorumSet = QuorumSetStorage.fromQuorumSet(node.quorumSet);
        nodeSnapShot.nodeDetails = NodeDetailsStorage.fromNode(node);
        nodeSnapShot.geoData = GeoDataStorage.fromGeoData(node.geoData);

        /*if (organization) {
            let urlFriendlyName = slugify(organization.name);
            let organizationStorageV2 = organizationStorageV2Cache.get(urlFriendlyName);
            if (!organizationStorageV2) { //initialize
                let organizationIdStorage = await getStoredOrganizationId(urlFriendlyName);
                if (!organizationIdStorage) {
                    organizationIdStorage = new OrganizationIdStorage(urlFriendlyName);
                }
                organizationStorageV2 = new OrganizationStorageV2(
                    organizationIdStorage,
                    {
                        name: organization.name,
                        dba: organization.dba,
                        url: organization.url,
                        logo: organization.logo,
                        description: organization.description,
                        physicalAddress: organization.physicalAddress,
                        physicalAddressAttestation: organization.physicalAddressAttestation,
                        phoneNumber: organization.phoneNumber,
                        phoneNumberAttestation: organization.phoneNumberAttestation,
                        keybase: organization.keybase,
                        twitter: organization.twitter,
                        github: organization.github,
                        officialEmail: organization.officialEmail,
                        validators: organization.validators
                    });
                organizationStorageV2Cache.set(urlFriendlyName, organizationStorageV2);
            }
            nodeStorageV2.organization = organizationStorageV2;
        }*/
        await this.nodeSnapShotRepository.save(nodeSnapShot);

        return nodeSnapShot;
    }

    quorumSetChanged(node: Node, nodeSnapShot: NodeSnapShot): boolean {
        if(!nodeSnapShot.quorumSet)
            return node.isValidator;

        return nodeSnapShot.quorumSet.hash !== node.quorumSet.hashKey;
    }

    nodeIpPortChanged(node: Node, nodeSnapShot: NodeSnapShot):boolean {
        return nodeSnapShot.ip !== node.ip
            || nodeSnapShot.port !== node.port;
    }
    nodeDetailsChanged(node: Node, nodeSnapShot: NodeSnapShot):boolean {
        if(!nodeSnapShot.nodeDetails)
            return node.versionStr !== undefined || node.overlayVersion !== undefined || node.overlayMinVersion !== undefined || node.ledgerVersion !== undefined;

        return nodeSnapShot.nodeDetails.alias !== node.alias
            || nodeSnapShot.nodeDetails.historyUrl !== node.historyUrl
            || nodeSnapShot.nodeDetails.homeDomain !== node.homeDomain
            || nodeSnapShot.nodeDetails.host !== node.host
            || nodeSnapShot.nodeDetails.isp !== node.isp
            || nodeSnapShot.nodeDetails.ledgerVersion !== node.ledgerVersion
            || nodeSnapShot.nodeDetails.name !== node.name
            || nodeSnapShot.nodeDetails.overlayMinVersion !== node.overlayMinVersion
            || nodeSnapShot.nodeDetails.overlayVersion !== node.overlayVersion
            || nodeSnapShot.nodeDetails.versionStr !== node.versionStr;
    }

    geoDataChanged(node:Node, nodeSnapShot: NodeSnapShot):boolean {
        if(!nodeSnapShot.geoData) {
           return node.geoData.latitude !== undefined || node.geoData.longitude !== undefined;
        }

        return nodeSnapShot.geoData.latitude !== node.geoData.latitude
            || nodeSnapShot.geoData.longitude !== node.geoData.longitude;
    }
}