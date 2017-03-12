/// <reference types="es6-promise" />
/// <reference types="node" />
import * as events from "events";
import * as asg from 'autoscalable-grid';
export declare type WorkerKey = string;
export interface IWorkersLaunchRequest {
    NumInstances: number;
    Hint?: any;
}
export interface IAutoScalerImplementation {
    TranslateToWorkerKeys: (workers: asg.IWorker[]) => Promise<WorkerKey[]>;
    ComputeWorkersLaunchRequest: (state: asg.IAutoScalableState) => Promise<IWorkersLaunchRequest>;
    LaunchInstances: (launchRequest: IWorkersLaunchRequest) => Promise<WorkerKey[]>;
    TerminateInstances: (workers: asg.IWorker[]) => Promise<WorkerKey[]>;
    getConfigUrl: () => Promise<string>;
}
export interface Options {
    EnabledAtStart?: boolean;
    MaxWorkersCap?: number;
    MinWorkersCap?: number;
    PollingIntervalMS?: number;
    TerminateWorkerAfterMinutesIdle?: number;
}
export interface IGridAutoScalerJSON {
    Scaling: boolean;
    Enabled: boolean;
    HasMaxWorkersCap: boolean;
    MaxWorkersCap: number;
    HasMinWorkersCap: boolean;
    MinWorkersCap: number;
    LaunchingWorkers: WorkerKey[];
}
export interface IGridAutoScaler {
    isScaling: () => Promise<boolean>;
    upScale: (launchRequest: IWorkersLaunchRequest) => Promise<boolean>;
    downScale: (toBeTerminatedWorkers: asg.IWorker[]) => Promise<boolean>;
    isEnabled: () => Promise<boolean>;
    enable: () => Promise<any>;
    disable: () => Promise<any>;
    hasMaxWorkersCap: () => Promise<boolean>;
    hasMixWorkersCap: () => Promise<boolean>;
    getMaxWorkersCap: () => Promise<number>;
    setMaxWorkersCap: (value: number) => Promise<number>;
    getMinWorkersCap: () => Promise<number>;
    setMinWorkersCap: (value: number) => Promise<number>;
    getLaunchingWorkers: () => Promise<WorkerKey[]>;
    getJSON: () => Promise<IGridAutoScalerJSON>;
    getImplementationConfigUrl: () => Promise<string>;
}
export declare class GridAutoScaler extends events.EventEmitter {
    private scalableGrid;
    private implementation;
    private options;
    private __enabled;
    private __MaxWorkersCap;
    private __MinWorkersCap;
    private __launchingWorkers;
    constructor(scalableGrid: asg.IAutoScalableGrid, implementation: IAutoScalerImplementation, options?: Options);
    readonly Scaling: boolean;
    readonly LaunchingWorkers: WorkerKey[];
    Enabled: boolean;
    readonly HasMaxWorkersCap: boolean;
    MaxWorkersCap: number;
    readonly HasMinWorkersCap: boolean;
    MinWorkersCap: number;
    private getWorkerFromState(state);
    private getUpScalePromise(launchRequest);
    private getDownScalePromise(toBeTerminatedWorkers);
    private onUpScalingComplete(workersKeys);
    private onDownScalingComplete(workersKeys);
    upScale(launchRequest: IWorkersLaunchRequest): Promise<boolean>;
    downScale(toBeTerminatedWorkers: asg.IWorker[]): Promise<boolean>;
    private getAutoDownScalingPromise(state);
    private getAutoUpScalingWithTaskDebtPromise(state);
    private getAutoUpScalingPromise(state);
    private feedLastestWorkerStates(workerStates);
    private readonly AutoScalingPromise;
    private readonly TimerFunction;
    readonly ImplementationConfigUrl: Promise<string>;
    toJSON(): IGridAutoScalerJSON;
}
